import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { cancelAllJobs, isActive } from './jobRunner.js';
import { startCleanup } from './sessions.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`✔ Bulk mailer server: http://localhost:${config.port} (${config.nodeEnv})`);
  if (config.gmailUser) console.log(`  Default Gmail account from .env: ${config.gmailUser}`);
  if (!config.accessToken && config.nodeEnv === 'production') {
    console.warn('  ⚠ ACCESS_TOKEN is not set — set it before exposing this server publicly.');
  }
});

startCleanup(isActive);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down…`);
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
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
