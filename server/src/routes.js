import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { AppError } from './errors.js';
import { buildSampleWorkbook, isValidEmail, readWorkbook } from './excel.js';
import { cancelJob, isActive, pauseJob, resumeJob, snapshot, startJob } from './jobRunner.js';
import { describeSmtpError, verifyCredentials } from './mailer.js';
import { log } from './logger.js';
import { createSession, deleteSession, getSession } from './sessions.js';

const MB = 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Gmail refuses these attachment types outright.
const BLOCKED_EXT =
  /\.(ade|adp|apk|appx|bat|cab|chm|cmd|com|cpl|dll|dmg|exe|hta|ins|isp|iso|jar|js|jse|lib|lnk|mde|msc|msi|msp|mst|nsh|pif|ps1|scr|sct|shb|sys|vb|vbe|vbs|vxd|wsc|wsf|wsh)$/i;

const router = Router();

const runUpload = (middleware, req, res) =>
  new Promise((resolve, reject) => middleware(req, res, (err) => (err ? reject(err) : resolve())));

// Busboy decodes non-ASCII filenames as latin1; recover the UTF-8 name when possible.
const fixFilename = (name) => {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
};

const singleLine = (value, max) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

const excelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.mailSession.dir),
    filename: (req, file, cb) => cb(null, 'recipients.xlsx'),
  }),
  limits: { fileSize: config.maxExcelSizeMb * MB, files: 1 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.xlsx') cb(null, true);
    else cb(new AppError('Only .xlsx files are supported (open .xls / .csv files in Excel and use "Save As .xlsx").', 400));
  },
}).single('file');

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.attachmentDir),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: {
    fileSize: config.maxAttachmentTotalMb * MB,
    files: config.maxAttachments,
    fieldSize: 2 * MB,
    fields: 20,
  },
  fileFilter: (req, file, cb) => {
    if (BLOCKED_EXT.test(file.originalname)) {
      cb(new AppError(`Gmail does not allow this file type: "${fixFilename(file.originalname)}".`, 400));
    } else cb(null, true);
  },
}).array('attachments', config.maxAttachments);

const verifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a minute.' },
});

function loadSession(req) {
  const session = getSession(req.params.id);
  if (!session) throw new AppError('Session expired. Please upload the Excel file again.', 404);
  session.touchedAt = Date.now();
  return session;
}

function resolveCredentials(body) {
  const user = String(body.email ?? '').trim() || config.gmailUser;
  let pass = String(body.appPassword ?? '').replace(/\s+/g, '');
  if (!pass && config.gmailUser && user.toLowerCase() === config.gmailUser.toLowerCase()) {
    pass = config.gmailAppPassword;
  }
  if (!user || !isValidEmail(user)) throw new AppError('Enter a valid Gmail address.', 400);
  if (!pass) throw new AppError('Enter your Gmail App Password.', 400);
  if (pass.length !== 16) {
    throw new AppError('An App Password is 16 characters long (create one at Google Account → App passwords).', 400);
  }
  return { user, pass };
}

function summarize(session, book) {
  const nameHeader = book.headers.find((h) => /name/i.test(h) && h !== book.emailHeader);
  const rows = book.rows.map((r) => ({
    rowNumber: r.rowNumber,
    to: r.emails.join(', ') || r.raw,
    name: nameHeader ? r.data[nameHeader] : '',
    valid: r.emails.length > 0,
    alreadySent: r.alreadySent,
  }));
  return {
    sessionId: session.id,
    fileName: session.originalName,
    headers: book.headers,
    emailHeader: book.emailHeader,
    sample: (book.rows.find((r) => r.emails.length) ?? book.rows[0]).data,
    counts: {
      total: rows.length,
      valid: rows.filter((r) => r.valid).length,
      invalid: rows.filter((r) => !r.valid).length,
      alreadySent: rows.filter((r) => r.alreadySent).length,
    },
    rows,
  };
}

router.get('/auth', (req, res) => res.json({ ok: true }));

router.get('/sample', async (req, res) => {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', 'attachment; filename="sample-recipients.xlsx"');
  await buildSampleWorkbook().xlsx.write(res);
  res.end();
});

router.post('/verify', verifyLimiter, async (req, res) => {
  const creds = resolveCredentials(req.body ?? {});
  try {
    await verifyCredentials(creds);
  } catch (err) {
    throw new AppError(describeSmtpError(err), 400);
  }
  res.json({ ok: true, email: creds.user });
});

router.post('/sessions', async (req, res) => {
  const session = await createSession();
  req.mailSession = session;
  try {
    try {
      await runUpload(excelUpload, req, res);
    } catch (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') throw new AppError(`Excel file must be smaller than ${config.maxExcelSizeMb} MB.`, 400);
      throw err;
    }
    if (!req.file) throw new AppError('Please select an Excel file.', 400);
    session.originalName = path.basename(fixFilename(req.file.originalname)).replace(/[^\w.\- ()\u0900-\u097F]/g, '_');
    const book = await readWorkbook(session.excelPath);
    const summary = summarize(session, book);
    log.info(
      `Excel uploaded: "${session.originalName}" session=${session.id.slice(0, 8)}`,
      `rows=${summary.counts.total} valid=${summary.counts.valid} emailColumn="${book.emailHeader}"`,
    );
    res.status(201).json(summary);
  } catch (err) {
    await deleteSession(session.id).catch(() => {});
    throw err;
  }
});

router.delete('/sessions/:id', async (req, res) => {
  const session = loadSession(req);
  if (isActive(session)) throw new AppError('Sending is in progress. Cancel it first.', 409);
  await deleteSession(session.id);
  res.status(204).end();
});

router.post('/sessions/:id/start', verifyLimiter, async (req, res) => {
  const session = loadSession(req);
  if (isActive(session) || session.starting) throw new AppError('Emails for this file are already being sent.', 409);

  const attachmentDir = path.join(session.dir, `attachments-${Date.now()}`);
  await fs.mkdir(attachmentDir, { recursive: true });
  req.attachmentDir = attachmentDir;

  try {
    try {
      await runUpload(attachmentUpload, req, res);
    } catch (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        throw new AppError(`Total attachment size cannot exceed ${config.maxAttachmentTotalMb} MB.`, 400);
      }
      if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
        throw new AppError(`A maximum of ${config.maxAttachments} attachments is allowed.`, 400);
      }
      throw err;
    }

    const files = req.files ?? [];
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > config.maxAttachmentTotalMb * MB) {
      throw new AppError(`Total attachment size cannot exceed ${config.maxAttachmentTotalMb} MB.`, 400);
    }

    const body = req.body ?? {};
    const creds = resolveCredentials(body);
    const subject = singleLine(body.subject, 500);
    const content = String(body.body ?? '');
    const fromName = singleLine(body.fromName, 100).replace(/["<>]/g, '');
    const replyTo = singleLine(body.replyTo, 254);
    const delay = Number.parseInt(body.delayMs, 10);

    if (!subject) throw new AppError('Please enter a subject.', 400);
    if (!content.trim()) throw new AppError('Please write the email body.', 400);
    if (content.length > 500_000) throw new AppError('Email body is too large.', 400);
    if (replyTo && !isValidEmail(replyTo)) throw new AppError('Reply-To email is not valid.', 400);

    const snap = await startJob(session, {
      creds,
      attachmentDir,
      attachments: files.map((f) => ({
        filename: fixFilename(f.originalname),
        path: f.path,
        contentType: f.mimetype,
      })),
      subject,
      body: content,
      isHtml: body.isHtml === 'true',
      fromName: fromName || config.defaultFromName,
      replyTo,
      delayMs: Math.min(Math.max(Number.isFinite(delay) ? delay : config.defaultDelayMs, 300), 60_000),
      skipAlreadySent: body.skipAlreadySent !== 'false',
    });
    res.status(202).json(snap);
  } catch (err) {
    await fs.rm(attachmentDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
});

router.post('/sessions/:id/pause', (req, res) => {
  pauseJob(loadSession(req));
  res.json({ ok: true });
});

router.post('/sessions/:id/resume', (req, res) => {
  resumeJob(loadSession(req));
  res.json({ ok: true });
});

router.post('/sessions/:id/cancel', (req, res) => {
  cancelJob(loadSession(req));
  res.json({ ok: true });
});

router.get('/sessions/:id/events', (req, res) => {
  const session = loadSession(req);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = ({ event, data }) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send({ event: 'snapshot', data: snapshot(session) });
  session.emitter.on('evt', send);

  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    session.emitter.off('evt', send);
  });
});

router.get('/sessions/:id/download', async (req, res) => {
  const session = loadSession(req);
  await fs.access(session.excelPath).catch(() => {
    throw new AppError('File not found.', 404);
  });
  res.download(session.excelPath, session.originalName, {
    dotfiles: 'allow',
    headers: { 'Cache-Control': 'no-store' },
  });
});

export default router;
