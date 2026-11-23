import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const trustProxy = (value) => {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  return value;
};

export const config = {
  port: int(process.env.PORT, 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: trustProxy(process.env.TRUST_PROXY),

  gmailUser: (process.env.GMAIL_USER || '').trim(),
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  defaultFromName: process.env.FROM_NAME || '',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: int(process.env.SMTP_PORT, 465),
  smtpSecure: process.env.SMTP_SECURE !== 'false',

  accessToken: process.env.ACCESS_TOKEN || '',
  timeZone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,

  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(here, '..', 'uploads')),
  logDir: path.resolve(process.env.LOG_DIR || path.join(here, '..', 'logs')),
  clientDist: path.resolve(here, '..', '..', 'client', 'dist'),

  maxExcelSizeMb: int(process.env.MAX_EXCEL_SIZE_MB, 10),
  // Gmail rejects messages over 25 MB after base64 encoding (~33% overhead).
  maxAttachmentTotalMb: int(process.env.MAX_ATTACHMENT_TOTAL_MB, 18),
  maxAttachments: int(process.env.MAX_ATTACHMENTS, 10),
  maxRecipients: int(process.env.MAX_RECIPIENTS, 2000),
  defaultDelayMs: int(process.env.DEFAULT_DELAY_MS, 1500),
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 24),
};
