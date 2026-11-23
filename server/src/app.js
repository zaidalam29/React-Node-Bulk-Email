import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './errors.js';
import { requestLogger } from './logger.js';
import router from './routes.js';

const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  if (!domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 3))}@${domain}`;
};

function requireAccessToken(req, res, next) {
  if (!config.accessToken) return next();
  const provided = Buffer.from(String(req.get('x-access-token') || req.query.token || ''));
  const expected = Buffer.from(config.accessToken);
  if (provided.length === expected.length && timingSafeEqual(provided, expected)) return next();
  res.status(401).json({ error: 'Access token is invalid or missing.' });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // Email previews (rendered in a srcdoc iframe) may reference remote images.
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https:'] } } }));
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.get('/api/config', (req, res) => {
    res.json({
      authRequired: Boolean(config.accessToken),
      envCredentials: Boolean(config.gmailUser && config.gmailAppPassword),
      envGmailUser: config.gmailUser ? maskEmail(config.gmailUser) : '',
      defaultFromName: config.defaultFromName,
      defaultDelayMs: config.defaultDelayMs,
      limits: {
        maxExcelSizeMb: config.maxExcelSizeMb,
        maxAttachmentTotalMb: config.maxAttachmentTotalMb,
        maxAttachments: config.maxAttachments,
        maxRecipients: config.maxRecipients,
      },
    });
  });

  app.use(
    '/api',
    rateLimit({ windowMs: 15 * 60_000, limit: 1500, standardHeaders: 'draft-7', legacyHeaders: false }),
    requireAccessToken,
    router,
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
