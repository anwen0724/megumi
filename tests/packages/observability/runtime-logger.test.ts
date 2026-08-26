// @vitest-environment node
/* Verifies the independent strict Runtime Log stream and automatic Trace correlation. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeRuntimeLogLine,
  RuntimeLogEntrySchema,
} from '../../../packages/agent/observability/src/runtime/runtime-log-entry';
import {
  createRuntimeLogger,
  RUNTIME_DRAIN_INTERVAL_MS,
  RUNTIME_QUEUE_CAPACITY_BYTES,
} from '../../../packages/agent/observability/src/runtime/runtime-logger';
import { createTraceContext } from '../../../packages/agent/observability/src/trace/trace-context';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Runtime Logger', () => {
  it('uses its own fixed 4 MiB queue and 250 ms drain policy', () => {
    expect(RUNTIME_QUEUE_CAPACITY_BYTES).toBe(4 * 1024 * 1024);
    expect(RUNTIME_DRAIN_INTERVAL_MS).toBe(250);
  });
  it('writes a strict independent Runtime segment with current Trace and Span IDs', async () => {
    const storage = new ObservabilityMemoryStorage();
    const context = createTraceContext();
    const logger = createRuntimeLogger({
      rootDirectory: 'observability',
      storage,
      context,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
      createId: () => '00000000-0000-4000-8000-000000000001',
      drainIntervalMs: 60_000,
    });

    context.run({
      traceId: '00000000-0000-4000-8000-000000000002',
      traceKind: 'conversation',
      currentSpanId: '00000000-0000-4000-8000-000000000003',
      correlation: { requestId: 'request-1' },
      lifecycle: { sequence: 1, diagnosticsDropped: false },
    }, () => logger.write({
      level: 'warn',
      module: 'database',
      code: 'database_busy',
      message: 'Database retry scheduled.',
      data: { attempt: 2, inputTokens: 64, apiKey: 'must-never-appear' },
      error: {
        name: 'DatabaseError',
        message: 'Failed with Bearer error-secret-value',
        stack: 'DatabaseError: apiKey=stack-secret-value',
      },
    }));
    await logger.flush();

    const filePath = join(
      'observability',
      'runtime',
      'runtime-v1-2026-08-26-0001.jsonl',
    );
    expect(storage.filePaths()).toEqual([filePath]);
    const entry = decodeRuntimeLogLine((await storage.readText(filePath)).trim());
    expect(entry).toMatchObject({
      level: 'warn',
      module: 'database',
      code: 'database_busy',
      message: 'Database retry scheduled.',
      traceId: '00000000-0000-4000-8000-000000000002',
      spanId: '00000000-0000-4000-8000-000000000003',
      correlation: { requestId: 'request-1' },
      data: { attempt: 2, inputTokens: 64, apiKey: '[redacted]' },
    });
    expect(JSON.stringify(entry)).not.toContain('must-never-appear');
    expect(JSON.stringify(entry)).not.toContain('error-secret-value');
    expect(JSON.stringify(entry)).not.toContain('stack-secret-value');
  });

  it('rejects unknown fields, levels, and non-JSON runtime data', () => {
    const base = {
      schemaVersion: 1,
      recordId: '00000000-0000-4000-8000-000000000001',
      timestamp: '2026-08-26T12:00:00.000Z',
      level: 'info',
      module: 'desktop',
      code: 'desktop_started',
      message: 'Desktop started.',
    };

    expect(RuntimeLogEntrySchema.safeParse({ ...base, unknown: true }).success).toBe(false);
    expect(RuntimeLogEntrySchema.safeParse({ ...base, level: 'fatal' }).success).toBe(false);
    expect(RuntimeLogEntrySchema.safeParse({ ...base, data: { invalid: BigInt(1) } }).success).toBe(false);
  });
});
