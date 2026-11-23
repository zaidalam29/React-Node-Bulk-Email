import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.logDir, { recursive: true });
const stream = fs.createWriteStream(path.join(config.logDir, 'server.log'), { flags: 'a' });

const format = (value) => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
};

function write(level, args) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${args.map(format).join(' ')}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  stream.write(`${line}\n`);
}

export const log = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};

export function requestLogger(req, res, next) {
  if (!req.path.startsWith('/api/') || req.path.endsWith('/events') || req.path === '/api/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    write(level, [`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${Date.now() - start} ms)`]);
  });
  next();
}
