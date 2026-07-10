/*
 * Owns the Megumi runtime JSONL envelope, redaction, truncation, and log path.
 * Consumers provide only append and clock capabilities.
 */
import path from 'node:path';
import type { RuntimeLogger } from '../../coding-agent/composition';
import { redactRuntimeValue } from './redaction';

export const PRODUCT_RUNTIME_LOG_FILE_NAME = 'runtime.jsonl';

export interface RuntimeLogWriterPort {
  appendText(filePath: string, text: string): void;
}

export interface RuntimeLogClockPort {
  now(): Date;
}

export interface ProductRuntimeLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  details?: Record<string, unknown>;
}

export const noopRuntimeLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createProductRuntimeLogger(options: {
  logsPath: string;
  writer: RuntimeLogWriterPort;
  clock: RuntimeLogClockPort;
  maxStringLength?: number;
  onWriteFailure?: (error: unknown) => void;
}): RuntimeLogger {
  const filePath = path.join(options.logsPath, PRODUCT_RUNTIME_LOG_FILE_NAME);
  const maxStringLength = options.maxStringLength ?? 4096;

  function write(level: ProductRuntimeLogEntry['level'], event: string, details?: Record<string, unknown>): void {
    const entry: ProductRuntimeLogEntry = {
      timestamp: options.clock.now().toISOString(),
      level,
      event: truncateRuntimeValue(event, maxStringLength),
      ...(details
        ? { details: truncateRuntimeValue(redactRuntimeValue(details), maxStringLength) }
        : {}),
    };
    try {
      options.writer.appendText(filePath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      options.onWriteFailure?.(error);
    }
  }

  return {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}

function truncateRuntimeValue<T>(value: T, maxStringLength: number): T {
  if (typeof value === 'string') {
    if (value === '[redacted]') return value;
    return (value.length <= maxStringLength
      ? value
      : `${value.slice(0, maxStringLength)}…[truncated]`) as T;
  }
  if (Array.isArray(value)) return value.map((item) => truncateRuntimeValue(item, maxStringLength)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, truncateRuntimeValue(item, maxStringLength)]),
  ) as T;
}
