// Loads the local project .env into the desktop process environment before runtime composition.
import fs from 'node:fs';
import path from 'node:path';

export interface LoadDesktopEnvFileOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export function loadDesktopEnvFile(options: LoadDesktopEnvFileOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const envPath = path.join(cwd, '.env');

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!key || env[key]) continue;

    env[key] = value;
  }
}
