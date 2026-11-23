import './env.js';
import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { cancelAllJobs, isActive } from './jobRunner.js';
import { log } from './logger.js';
import { startCleanup } from './sessions.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = createApp();
const server = app.listen(config.port, () => {
  log.info(`✔ Bulk mailer server: http://localhost:${config.port} (${config.nodeEnv})`);
  log.info(`  Logs: ${config.logDir}/server.log`);
  if (config.gmailUser) log.info(`  Default Gmail account from .env: ${config.gmailUser}`);
  if (!config.accessToken && config.nodeEnv === 'production') {
    log.warn('  ⚠ ACCESS_TOKEN is not set — set it before exposing this server publicly.');
  }
});

server.on('error', (err) => {
  log.error('Server failed to start:', err);
  process.exit(1);
});

startCleanup(isActive);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down…`);
  cancelAllJobs();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
  process.exit(1);
});
