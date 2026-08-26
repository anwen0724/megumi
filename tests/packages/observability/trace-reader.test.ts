// @vitest-environment node
/* Verifies strict file ordering, Trace projection, Content validation, and incomplete diagnostics. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeTraceJournalRecord, type TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import type { TraceIndex } from '../../../packages/agent/observability/src/persistence/trace-index';
import { createTraceReader } from '../../../packages/agent/observability/src/query/trace-reader';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Trace Reader', () => {
  it('folds a cross-segment Trace by filename and sequence with spans, links, events, and Content', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000001';
    const rootSpanId = '00000000-0000-4000-8000-000000000010';
    const firstChildId = '00000000-0000-4000-8000-000000000011';
    const secondChildId = '00000000-0000-4000-8000-000000000012';
    const storedBytes = new TextEncoder().encode('provider response body');
    const contentId = sha256(storedBytes);
    const records = completeRecords(
      traceId,
      rootSpanId,
      firstChildId,
      secondChildId,
      contentId,
      storedBytes.byteLength,
    );
    seedSegment(storage, '2026-08-26', 2, records.slice(6));
    seedSegment(storage, '2026-08-26', 1, records.slice(0, 6));
    storage.seedBytes(blobPath(contentId), storedBytes);
    const reader = createTraceReader({ rootDirectory: 'observability', storage });

    const detail = await reader.getTrace(traceId);

    expect(detail).toMatchObject({
      traceId,
      traceKind: 'conversation',
      status: 'ok',
      recordedOutcome: { status: 'ok' },
      diagnostics: 'complete',
    });
    expect(detail?.records.map((record) => record.sequence)).toEqual(
      Array.from({ length: records.length }, (_, index) => index + 1),
    );
    expect(detail?.spans.map((span) => ({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
    }))).toEqual([
      { spanId: rootSpanId, parentSpanId: undefined },
      { spanId: firstChildId, parentSpanId: rootSpanId },
      { spanId: secondChildId, parentSpanId: rootSpanId },
    ]);
    expect(detail?.spans.find((span) => span.spanId === firstChildId)?.events).toEqual([
      expect.objectContaining({
        sequence: 5,
        timestamp: '2026-08-26T00:00:05.000Z',
        event: { type: 'model.output.started', providerAttempt: 1 },
      }),
    ]);
    expect(detail?.correlations).toContainEqual({ requestId: `request-${traceId.slice(-3)}` });
    expect(detail?.links).toEqual([expect.objectContaining({ linkKind: 'retries' })]);
    expect(detail?.contents.map((content) => content.kind)).toEqual([
      'prompt.final',
      'model.provider_response',
    ]);
    expect(detail?.issues).toEqual([]);
    await expect(reader.readContent(contentId)).resolves.toEqual({
      status: 'available',
      bytes: storedBytes,
    });
  });

  it('marks structural and Content evidence gaps incomplete without rewriting business outcome', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000101';
    const missingContentId = 'a'.repeat(64);
    const records: TraceJournalRecord[] = [
      started(traceId, 1),
      {
        ...base(traceId, 3),
        type: 'span.started',
        spanId: '00000000-0000-4000-8000-000000000110',
        parentSpanId: '00000000-0000-4000-8000-000000000199',
        name: 'agent.execution',
        correlation: {},
      },
      {
        ...base(traceId, 4),
        type: 'content.recorded',
        kind: 'context.resolved',
        content: {
          mode: 'stored',
          contentId: missingContentId,
          mediaType: 'application/json',
          byteLength: 100,
        },
        correlation: {},
      },
      {
        ...base(traceId, 5),
        type: 'trace.ended',
        outcome: { status: 'error', code: 'model_failed', message: 'Model failed.' },
        diagnostics: 'complete',
      },
    ];
    seedSegment(storage, '2026-08-26', 1, records);
    const reader = createTraceReader({ rootDirectory: 'observability', storage });

    const detail = await reader.getTrace(traceId);

    expect(detail?.status).toBe('incomplete');
    expect(detail?.recordedOutcome).toEqual({
      status: 'error',
      code: 'model_failed',
      message: 'Model failed.',
    });
    expect(detail?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'sequence_gap',
      'missing_span_end',
      'invalid_parent',
      'missing_content',
    ]));
  });

  it('turns duplicate lifecycle and unknown schema lines into explicit incomplete issues', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000201';
    const duplicateStart = started(traceId, 2);
    const segment = [
      encodeTraceJournalRecord(started(traceId, 1)),
      encodeTraceJournalRecord(duplicateStart),
      JSON.stringify({
        schemaVersion: 99,
        type: 'future.record',
        traceId,
        sequence: 3,
      }),
    ].join('\n');
    storage.seedText(segmentPath('2026-08-26', 1), `${segment}\n`);
    const reader = createTraceReader({ rootDirectory: 'observability', storage });

    const detail = await reader.getTrace(traceId);

    expect(detail?.status).toBe('incomplete');
    expect(detail?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_trace_start',
      'unknown_schema',
      'missing_trace_end',
    ]));
  });

  it('detects a stored Content hash mismatch', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000202';
    const contentId = 'd'.repeat(64);
    const records: TraceJournalRecord[] = [
      started(traceId, 1),
      {
        ...base(traceId, 2),
        type: 'content.recorded',
        kind: 'model.response',
        content: {
          mode: 'stored',
          contentId,
          mediaType: 'text/plain;charset=utf-8',
          byteLength: 7,
        },
        correlation: {},
      },
      {
        ...base(traceId, 3),
        type: 'trace.ended',
        outcome: { status: 'ok' },
        diagnostics: 'complete',
      },
    ];
    seedSegment(storage, '2026-08-26', 1, records);
    storage.seedBytes(blobPath(contentId), new TextEncoder().encode('corrupt'));
    const reader = createTraceReader({ rootDirectory: 'observability', storage });

    const detail = await reader.getTrace(traceId);

    expect(detail?.status).toBe('incomplete');
    expect(detail?.recordedOutcome).toEqual({ status: 'ok' });
    expect(detail?.issues).toContainEqual(expect.objectContaining({ code: 'content_hash_mismatch' }));
  });

  it('keeps streaming Journal reads available when every Derived Index operation fails', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000203';
    seedSegment(storage, '2026-08-26', 1, [
      started(traceId, 1),
      {
        ...base(traceId, 2),
        type: 'trace.ended',
        outcome: { status: 'ok' },
        diagnostics: 'complete',
      },
    ]);
    const failedIndex: TraceIndex = {
      initialize: () => { throw new Error('Index unavailable.'); },
      replace: () => { throw new Error('Index unavailable.'); },
      queryTraceIds: () => { throw new Error('Index unavailable.'); },
      matchesCheckpoints: () => { throw new Error('Index unavailable.'); },
      prune: async () => { throw new Error('Index unavailable.'); },
    };
    const reader = createTraceReader({
      rootDirectory: 'observability',
      storage,
      index: failedIndex,
    });

    await expect(reader.listTraces({ correlation: { requestId: `request-${traceId.slice(-3)}` } }))
      .resolves.toEqual([expect.objectContaining({ traceId, status: 'ok' })]);
    await expect(reader.rebuildIndex()).resolves.toBe(false);
  });
});

function completeRecords(
  traceId: string,
  rootSpanId: string,
  firstChildId: string,
  secondChildId: string,
  contentId: string,
  byteLength: number,
): TraceJournalRecord[] {
  return [
    started(traceId, 1),
    spanStarted(traceId, 2, rootSpanId, undefined, 'agent.execution'),
    spanStarted(traceId, 3, firstChildId, rootSpanId, 'model.call'),
    spanStarted(traceId, 4, secondChildId, rootSpanId, 'tool.call'),
    {
      ...base(traceId, 5),
      type: 'span.event',
      spanId: firstChildId,
      event: {
        type: 'model.output.started',
        providerAttempt: 1,
      },
    },
    {
      ...base(traceId, 6),
      type: 'content.recorded',
      spanId: rootSpanId,
      kind: 'prompt.final',
      content: {
        mode: 'inline',
        contentId: sha256(new TextEncoder().encode('actual prompt')),
        mediaType: 'text/plain;charset=utf-8',
        value: 'actual prompt',
      },
      correlation: {},
    },
    {
      ...base(traceId, 7),
      type: 'content.recorded',
      spanId: firstChildId,
      kind: 'model.provider_response',
      content: {
        mode: 'stored',
        contentId,
        mediaType: 'text/plain;charset=utf-8',
        byteLength,
      },
      correlation: {},
    },
    {
      ...base(traceId, 8),
      type: 'trace.linked',
      linkKind: 'retries',
      targetTraceId: '00000000-0000-4000-8000-000000000099',
    },
    spanEnded(traceId, 9, firstChildId),
    spanEnded(traceId, 10, secondChildId),
    spanEnded(traceId, 11, rootSpanId),
    {
      ...base(traceId, 12),
      type: 'trace.ended',
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    },
  ];
}

function started(traceId: string, sequence: number): TraceJournalRecord {
  return {
    ...base(traceId, sequence),
    type: 'trace.started',
    traceKind: 'conversation',
    correlation: { requestId: `request-${traceId.slice(-3)}` },
  };
}

function spanStarted(
  traceId: string,
  sequence: number,
  spanId: string,
  parentSpanId: string | undefined,
  name: 'agent.execution' | 'model.call' | 'tool.call',
): TraceJournalRecord {
  return {
    ...base(traceId, sequence),
    type: 'span.started',
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    correlation: {},
  };
}

function spanEnded(
  traceId: string,
  sequence: number,
  spanId: string,
): TraceJournalRecord {
  return {
    ...base(traceId, sequence),
    type: 'span.ended',
    spanId,
    outcome: { status: 'ok' },
  };
}

function base(traceId: string, sequence: number) {
  return {
    schemaVersion: 1 as const,
    recordId: `00000000-0000-4000-8000-${String(300 + sequence).padStart(12, '0')}`,
    traceId,
    sequence,
    timestamp: `2026-08-26T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

function seedSegment(
  storage: ObservabilityMemoryStorage,
  date: string,
  segment: number,
  records: readonly TraceJournalRecord[],
): void {
  storage.seedText(
    segmentPath(date, segment),
    `${records.map(encodeTraceJournalRecord).join('\n')}\n`,
  );
}

function segmentPath(date: string, segment: number): string {
  return join(
    'observability',
    'traces',
    `trace-v1-${date}-${String(segment).padStart(4, '0')}.jsonl`,
  );
}

function blobPath(contentId: string): string {
  return join(
    'observability',
    'content',
    'sha256',
    contentId.slice(0, 2),
    `${contentId}.blob`,
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
