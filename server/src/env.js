import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded in code rather than via `node --env-file`, because `--watch` would then
// also watch the server folder and restart on every upload.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
