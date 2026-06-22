import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import path from 'node:path';
import { redactRuntimeValue } from '@megumi/coding-agent/adapters/local/security/redaction';
import type { MegumiHomePaths } from '../workspace/megumi-home.service';

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

export class RuntimeJsonlLogger implements RuntimeLogger {
  public constructor(private readonly filePath: string) {}

  public info(event: string, details?: Record<string, unknown>): void {
    this.write('info', event, details);
  }

  public warn(event: string, details?: Record<string, unknown>): void {
    this.write('warn', event, details);
  }

  public error(event: string, details?: Record<string, unknown>): void {
    this.write('error', event, details);
  }

  private write(level: RuntimeLogLevel, event: string, details?: Record<string, unknown>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const entry: RuntimeLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      details: redactRuntimeValue(details) as Record<string, unknown> | undefined,
    };

    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export function createRuntimeJsonlLoggerForMegumiHome(
  paths: Pick<MegumiHomePaths, 'logsPath'>,
): RuntimeLogger {
  return new RuntimeJsonlLogger(path.join(paths.logsPath, 'runtime.jsonl'));
}

export const noopRuntimeLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
