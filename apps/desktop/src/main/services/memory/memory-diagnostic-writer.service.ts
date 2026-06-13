// Writes best-effort long-term memory diagnostics without leaking raw sensitive content.
import { createHash } from 'node:crypto';
import { resolveMemoryDiagnosticsPath } from './memory-runtime-paths';
import type { MemoryRuntimeFileSystem } from './memory-runtime-file-system';

export type MemoryDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface MemoryDiagnosticWriterLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export interface MemoryDiagnosticEntryInput {
  operation: string;
  severity: MemoryDiagnosticSeverity;
  createdAt: string;
  homePath: string;
  runId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export class MemoryDiagnosticWriter {
  constructor(private readonly options: {
    fileSystem: MemoryRuntimeFileSystem;
    logger?: MemoryDiagnosticWriterLogger;
  }) {}

  async write(input: MemoryDiagnosticEntryInput): Promise<void> {
    const filePath = resolveMemoryDiagnosticsPath({
      homePath: input.homePath,
      createdAt: input.createdAt,
    });
    const entry = removeUndefined({
      createdAt: input.createdAt,
      operation: input.operation,
      severity: input.severity,
      runId: input.runId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      projectId: input.projectId ?? undefined,
      targetId: input.targetId ?? undefined,
      reason: input.reason ?? undefined,
      metadata: input.metadata ? sanitizeMetadata(input.metadata) : undefined,
    });

    try {
      const result = await this.options.fileSystem.appendJsonLine(filePath, entry);
      if (!result.ok) {
        this.options.logger?.warn('Failed to write memory diagnostic.', {
          reason: result.reason,
          message: result.message,
        });
      }
    } catch (error) {
      this.options.logger?.warn('Failed to write memory diagnostic.', {
        reason: 'append_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const FORBIDDEN_KEYS = new Set([
  'content',
  'rawcontent',
  'rawprompt',
  'rawtooloutput',
  'transcript',
  'plaintextsecret',
  'apikey',
  'password',
  'secret',
]);

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(value);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      continue;
    }
    if (normalizedKey === 'normalizedtext' && typeof child === 'string') {
      output.normalizedHash = createHash('sha256').update(child).digest('hex').slice(0, 16);
      continue;
    }
    if (normalizedKey === 'redactedsnippet' && typeof child === 'string') {
      output.redactedSnippet = child.slice(0, 160);
      continue;
    }
    output[key] = sanitizeValue(child);
  }
  return output;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}
