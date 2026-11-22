import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const sessions = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createSession() {
  const id = randomUUID();
  const dir = path.join(config.uploadDir, id);
  await fs.mkdir(dir, { recursive: true });

  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  const session = {
    id,
    dir,
    excelPath: path.join(dir, 'recipients.xlsx'),
    originalName: 'recipients.xlsx',
    touchedAt: Date.now(),
    starting: false,
    job: null,
    emitter,
  };
  sessions.set(id, session);
  return session;
}

export const getSession = (id) => (UUID_RE.test(id) ? sessions.get(id) : undefined);

export const allSessions = () => sessions.values();

export async function deleteSession(id) {
  const session = sessions.get(id);
  sessions.delete(id);
  if (session) {
    session.emitter.removeAllListeners();
    await fs.rm(session.dir, { recursive: true, force: true });
  }
}

export function emit(session, event, data) {
  session.touchedAt = Date.now();
  session.emitter.emit('evt', { event, data });
}

export function startCleanup(isActive) {
  const ttl = config.sessionTtlHours * 3_600_000;

  const sweep = async () => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (!isActive(session) && now - session.touchedAt > ttl) {
        await deleteSession(session.id).catch(() => {});
      }
    }
    const entries = await fs.readdir(config.uploadDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || sessions.has(entry.name)) continue;
      const dir = path.join(config.uploadDir, entry.name);
      const stat = await fs.stat(dir).catch(() => null);
      if (stat && now - stat.mtimeMs > ttl) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };

  sweep();
  setInterval(sweep, 3_600_000).unref();
}
