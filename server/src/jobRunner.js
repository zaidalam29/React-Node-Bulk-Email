import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { AppError } from './errors.js';
import { markRow, readWorkbook, saveWorkbook } from './excel.js';
import { createTransport, describeSmtpError, isFatalError, isTransientError } from './mailer.js';
import { emit, allSessions } from './sessions.js';
import { findUnknownPlaceholders, htmlToText, renderTemplate } from './template.js';

const ACTIVE = new Set(['running', 'paused']);
const MAX_ATTEMPTS = 3;

export const isActive = (session) => Boolean(session.job && ACTIVE.has(session.job.status));

export function snapshot(session) {
  const { job } = session;
  if (!job) return { status: 'idle', message: '', counters: null, current: null, results: [] };
  return {
    jobId: job.id,
    status: job.status,
    message: job.message,
    counters: job.counters,
    current: job.current,
    results: Object.values(job.results),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function setStatus(session, status, message = '') {
  const { job } = session;
  job.status = status;
  job.message = message;
  if (!ACTIVE.has(status)) job.finishedAt = Date.now();
  emit(session, 'status', { status, message, counters: job.counters });
}

function record(session, result) {
  const { job } = session;
  job.results[result.rowNumber] = result;
  job.counters[result.status] += 1;
  job.counters.pending -= 1;
  emit(session, 'result', { ...result, counters: job.counters });
}

function classifyRows(rows, skipAlreadySent) {
  const items = [];
  const skips = [];
  const seen = new Set();

  for (const row of rows) {
    const to = row.emails.join(', ') || row.raw;
    if (row.alreadySent && skipAlreadySent) {
      row.emails.forEach((e) => seen.add(e));
      skips.push({ row, to, reason: 'Already sent previously', mark: false });
      continue;
    }
    if (!row.emails.length) {
      skips.push({ row, to, reason: row.raw ? `Invalid email: ${row.raw}` : 'Email is empty', mark: true });
      continue;
    }
    const fresh = row.emails.filter((e) => !seen.has(e));
    if (!fresh.length) {
      skips.push({ row, to, reason: 'Duplicate email (already in an earlier row)', mark: true });
      continue;
    }
    fresh.forEach((e) => seen.add(e));
    items.push({ rowNumber: row.rowNumber, to: fresh.join(', '), emails: fresh, data: row.data });
  }
  return { items, skips };
}

function buildMessage(job, item) {
  const { subject, body, isHtml, fromName, replyTo } = job.opts;
  const message = {
    from: fromName ? { name: fromName, address: job.creds.user } : job.creds.user,
    to: item.emails,
    subject: renderTemplate(subject, item.data).replace(/[\r\n]+/g, ' '),
    attachments: job.attachments.map((a) => ({ ...a })),
  };
  if (replyTo) message.replyTo = replyTo;
  if (isHtml) {
    message.html = renderTemplate(body, item.data, { escape: true });
    message.text = htmlToText(message.html);
  } else {
    message.text = renderTemplate(body, item.data);
  }
  return message;
}

async function sendWithRetry(transport, message) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transport.sendMail(message);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransientError(err)) throw err;
      await sleep(3000 * attempt);
    }
  }
}

function waitIfPaused(job) {
  if (job.status !== 'paused') return undefined;
  return new Promise((resolve) => {
    job.resumeWaiter = resolve;
  });
}

async function interruptibleDelay(job, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && job.status !== 'cancelled') {
    await sleep(Math.min(200, end - Date.now()));
  }
}

async function runJob(session, transport) {
  const { job } = session;
  const { workbook, worksheet, statusCols } = job.book;

  try {
    for (let i = 0; i < job.items.length; i++) {
      await waitIfPaused(job);
      if (job.status === 'cancelled') break;

      const item = job.items[i];
      job.current = { rowNumber: item.rowNumber, to: item.to };
      emit(session, 'sending', job.current);

      let result;
      let fatalMessage = '';
      try {
        await sendWithRetry(transport, buildMessage(job, item));
        markRow(worksheet, statusCols, item.rowNumber, 'sent');
        result = { rowNumber: item.rowNumber, to: item.to, status: 'sent', at: Date.now() };
      } catch (err) {
        const error = describeSmtpError(err);
        markRow(worksheet, statusCols, item.rowNumber, 'failed', error);
        result = { rowNumber: item.rowNumber, to: item.to, status: 'failed', error, at: Date.now() };
        if (isFatalError(err)) fatalMessage = error;
      }

      try {
        await saveWorkbook(workbook, session.excelPath);
      } catch (err) {
        console.error('[job] Excel save failed', err);
        fatalMessage ||= `Could not save the Excel file: ${err.message}`;
      }

      job.current = null;
      record(session, result);

      if (fatalMessage) {
        job.status = 'stopped';
        job.message = `${fatalMessage} ${job.counters.pending} emails are still pending — fix the issue and start again.`;
        break;
      }
      if (i < job.items.length - 1) await interruptibleDelay(job, job.opts.delayMs);
    }
  } finally {
    transport.close();
    job.creds = null;
    job.current = null;
    await fs.rm(job.attachmentDir, { recursive: true, force: true }).catch(() => {});
  }

  const { sent, failed, skipped, pending } = job.counters;
  if (job.status === 'cancelled') {
    setStatus(session, 'cancelled', `Cancelled. ${sent} sent, ${pending} not sent.`);
  } else if (job.status === 'stopped') {
    setStatus(session, 'stopped', job.message);
  } else {
    setStatus(session, 'completed', `Done! ${sent} sent, ${failed} failed, ${skipped} skipped.`);
  }
}

export async function startJob(session, { creds, attachments, attachmentDir, ...opts }) {
  if (isActive(session) || session.starting) {
    throw new AppError('Emails for this file are already being sent.', 409);
  }
  session.starting = true;
  let transport;
  try {
    const book = await readWorkbook(session.excelPath);

    const unknown = findUnknownPlaceholders(`${opts.subject}\n${opts.body}`, book.headers);
    if (unknown.length) {
      throw new AppError(
        `These placeholders don't match any Excel header: ${unknown.map((u) => `{{${u}}}`).join(', ')}`,
        400,
      );
    }

    const { items, skips } = classifyRows(book.rows, opts.skipAlreadySent);
    if (items.length > config.maxRecipients) {
      throw new AppError(`A maximum of ${config.maxRecipients} recipients is allowed per run (this file has ${items.length}).`, 400);
    }

    transport = createTransport(creds);
    try {
      await transport.verify();
    } catch (err) {
      throw new AppError(describeSmtpError(err), 400);
    }

    const now = Date.now();
    const job = {
      id: randomUUID(),
      status: 'running',
      message: '',
      startedAt: now,
      finishedAt: null,
      opts,
      creds,
      attachments,
      attachmentDir,
      book,
      items,
      current: null,
      resumeWaiter: null,
      results: {},
      counters: { total: book.rows.length, sent: 0, failed: 0, skipped: skips.length, pending: items.length },
    };

    for (const { row, to, reason, mark } of skips) {
      if (mark) markRow(book.worksheet, book.statusCols, row.rowNumber, 'skipped', reason);
      job.results[row.rowNumber] = {
        rowNumber: row.rowNumber,
        to,
        status: 'skipped',
        error: reason,
        at: now,
        ...(mark ? {} : { already: true }),
      };
    }
    await saveWorkbook(book.workbook, session.excelPath);

    if (!items.length) {
      job.status = 'completed';
      job.message = 'No new valid email addresses to send to.';
      job.finishedAt = now;
      await fs.rm(attachmentDir, { recursive: true, force: true }).catch(() => {});
    }

    session.job = job;
    emit(session, 'snapshot', snapshot(session));

    if (items.length) {
      const owned = transport;
      transport = null;
      runJob(session, owned).catch((err) => {
        console.error('[job] crashed', err);
        setStatus(session, 'stopped', `Unexpected error: ${err.message}`);
      });
    }
    return snapshot(session);
  } finally {
    session.starting = false;
    transport?.close();
  }
}

export function pauseJob(session) {
  if (session.job?.status !== 'running') throw new AppError('No sending is in progress.', 409);
  setStatus(session, 'paused', 'Paused — sending stops after the current email.');
}

export function resumeJob(session) {
  const { job } = session;
  if (job?.status !== 'paused') throw new AppError('Sending is not paused.', 409);
  setStatus(session, 'running');
  job.resumeWaiter?.();
  job.resumeWaiter = null;
}

export function cancelJob(session) {
  const { job } = session;
  if (!isActive(session)) throw new AppError('No sending is in progress.', 409);
  setStatus(session, 'cancelled', 'Cancelling…');
  job.resumeWaiter?.();
  job.resumeWaiter = null;
}

export function cancelAllJobs() {
  for (const session of allSessions()) {
    if (isActive(session)) cancelJob(session);
  }
}
