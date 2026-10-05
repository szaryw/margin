import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Settings come from .env at the repo root (see .env.example); real environment variables win.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readEnv(file = join(root, '.env')) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = { ...readEnv(), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('MARGIN_') || k === 'OPENAI_API_KEY')) };
const home = p => p.replace(/^~(?=$|\/)/, homedir());

export const config = {
  port: 4319,
  loginPort: 4320,
  apiKey: env.OPENAI_API_KEY || '',
  model: env.MARGIN_MODEL || '',
  webSearch: !/^(off|false|0|no)$/i.test(env.MARGIN_WEB_SEARCH || 'on'),
  folder: resolve(home(env.MARGIN_DIR || '~/Documents/Margin')),
  authDir: join(root, '.auth')
};
