// Writes desktop runtime JSONL diagnostics with secret-like values redacted.
import fs from 'node:fs';
import path from 'node:path';

export type RuntimeLogLevel = 'info' | 'warn' | 'error';

export interface RuntimeLogEntry {
  timestamp: string;
  level: RuntimeLogLevel;
  event: string;
  details?: Record<string, unknown>;
}

export interface RuntimeLogger {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

export interface CreateRuntimeJsonlLoggerOptions {
  filePath: string;
  now?: () => string;
}

export function createRuntimeJsonlLogger(options: CreateRuntimeJsonlLoggerOptions): RuntimeLogger {
  const now = options.now ?? (() => new Date().toISOString());
  function write(level: RuntimeLogLevel, event: string, details?: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    const entry: RuntimeLogEntry = {
      timestamp: now(),
      level,
      event,
      ...(details ? { details: redactRuntimeValue(details) as Record<string, unknown> } : {}),
    };
    fs.appendFileSync(options.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
  return {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}

export const noopRuntimeLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function redactRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntimeValue);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    /api[-_]?key|authorization|token|secret|credential/i.test(key) ? '[redacted]' : redactRuntimeValue(entry),
  ]));
}
