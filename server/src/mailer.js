import nodemailer from 'nodemailer';
import { config } from './config.js';

const NETWORK_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET']);
const TRANSIENT_RESPONSE_CODES = new Set([421, 450, 451, 452, 454]);

export function createTransport({ user, pass }) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

export async function verifyCredentials(creds) {
  const transport = createTransport(creds);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

const responseText = (err) => String(err?.response || err?.message || '');

export const isAuthError = (err) => err?.code === 'EAUTH' || [534, 535].includes(err?.responseCode);

export const isQuotaError = (err) =>
  /5\.4\.5|sending limit exceeded|daily user sending quota/i.test(responseText(err));

const isNetworkError = (err) => NETWORK_CODES.has(err?.code);

export const isTransientError = (err) =>
  !isQuotaError(err) && (isNetworkError(err) || TRANSIENT_RESPONSE_CODES.has(err?.responseCode));

/** Errors that will fail every remaining email too, so the job should stop. */
export const isFatalError = (err) =>
  isAuthError(err) || isQuotaError(err) || isNetworkError(err) || err?.responseCode === 552;

export function describeSmtpError(err) {
  if (isAuthError(err)) {
    return 'Gmail login failed: wrong email or App Password. Make sure 2-Step Verification is on and create a new App Password.';
  }
  if (isQuotaError(err)) {
    return 'Gmail daily sending limit reached (personal ~500/day, Workspace ~2000/day). Try again after 24 hours.';
  }
  if (err?.responseCode === 552) {
    return 'Email exceeds the size limit. Use smaller attachments.';
  }
  if ([550, 553].includes(err?.responseCode)) {
    return `Recipient address rejected: ${responseText(err).slice(0, 200)}`;
  }
  if (isNetworkError(err)) {
    return 'Could not connect to Gmail SMTP (network issue).';
  }
  return responseText(err).slice(0, 300) || 'Unknown error';
}
