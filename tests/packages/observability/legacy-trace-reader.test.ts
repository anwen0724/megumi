// @vitest-environment node
/* Verifies the bounded legacy-only read window without inventing new Trace or Content facts. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLegacyTraceReader } from '../../../packages/agent/observability/src/query/legacy-trace-reader';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Legacy Trace Reader', () => {
  it('returns old observability.jsonl records only as legacy diagnostics without Content', async () => {
    const storage = new ObservabilityMemoryStorage();
    const directoryPath = join('megumi-home', 'logs');
    const traceId = 'legacy-trace-1';
    const records = [
      legacyRecord({ type: 'trace.started', traceId, sequence: 1, timestamp: '2026-08-20T00:00:00.000Z' }),
      legacyRecord({ type: 'trace.ended', traceId, sequence: 2, timestamp: '2026-08-20T00:00:02.000Z', status: 'ok' }),
    ];
    storage.seedText(
      join(directoryPath, 'observability.jsonl.1'),
      `${records.reverse().map((record) => JSON.stringify(record)).join('\n')}\n`,
      new Date('2026-08-20T00:00:03.000Z').getTime(),
    );
    const reader = createLegacyTraceReader({
      directoryPath,
      storage,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });

    const diagnostics = await reader.list();

    expect(diagnostics).toEqual([expect.objectContaining({
      kind: 'legacy diagnostic',
      traceId,
      executionId: 'execution-legacy-trace-1',
      status: 'ok',
      contentAvailable: false,
    })]);
    expect(diagnostics[0]?.records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(diagnostics[0]).not.toHaveProperty('contents');
  });

  it('ignores legacy files outside the 30 day migration window', async () => {
    const storage = new ObservabilityMemoryStorage();
    const directoryPath = join('megumi-home', 'logs');
    storage.seedText(
      join(directoryPath, 'observability.jsonl'),
      `${JSON.stringify(legacyRecord({
        type: 'trace.started',
        traceId: 'expired-trace',
        sequence: 1,
        timestamp: '2026-06-01T00:00:00.000Z',
      }))}\n`,
      new Date('2026-06-01T00:00:00.000Z').getTime(),
    );
    const reader = createLegacyTraceReader({
      directoryPath,
      storage,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });

    await expect(reader.list()).resolves.toEqual([]);
  });
});

function legacyRecord(input: {
  readonly type: 'trace.started' | 'trace.ended';
  readonly traceId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly status?: 'ok' | 'error' | 'cancelled';
}) {
  return {
    schemaVersion: 1,
    recordId: `legacy-record-${input.sequence}`,
    timestamp: input.timestamp,
    sequence: input.sequence,
    correlation: {
      traceId: input.traceId,
      executionId: `execution-${input.traceId}`,
    },
    attributes: {},
    type: input.type,
    name: 'agent_run',
    ...(input.status ? { status: input.status, durationMs: 2_000 } : {}),
  };
}
