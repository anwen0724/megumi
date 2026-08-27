// @vitest-environment node
/* Verifies strict file ordering, Trace projection, Content validation, and incomplete diagnostics. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeTraceJournalRecord, type TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import type {
  JournalCheckpoint,
  TraceIndex,
  TraceRecordLocator,
} from '../../../packages/agent/observability/src/persistence/trace-index';
import { createTraceReader } from '../../../packages/agent/observability/src/query/trace-reader';
import { summarizeTrace, type TraceProjection } from '../../../packages/agent/observability/src/query/trace-projector';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Trace Reader', () => {
  it('uses the Derived Index for repeated queries without rescanning Journal or reading Content bodies', async () => {
    const storage = new CountingObservabilityStorage();
    const firstTraceId = '00000000-0000-4000-8000-000000000001';
    const secondTraceId = '00000000-0000-4000-8000-000000000002';
    const firstContent = new TextEncoder().encode('first body');
    const secondContent = new TextEncoder().encode('second body');
    const firstContentId = sha256(firstContent);
    const secondContentId = sha256(secondContent);
    seedSegment(storage, '2026-08-26', 1, [
      started(firstTraceId, 1),
      storedContent(firstTraceId, 2, firstContentId, firstContent.byteLength),
      ended(firstTraceId, 3),
      started(secondTraceId, 1),
      storedContent(secondTraceId, 2, secondContentId, secondContent.byteLength),
      ended(secondTraceId, 3),
    ]);
    storage.seedBytes(blobPath(firstContentId), firstContent);
    storage.seedBytes(blobPath(secondContentId), secondContent);
    const reader = createTraceReader({
      rootDirectory: 'observability',
      storage,
      index: new MemoryTraceIndex(),
    });

    await reader.listTraces();
    storage.resetReads();

    await expect(reader.getTrace(secondTraceId)).resolves.toMatchObject({ traceId: secondTraceId });

    expect(storage.textReads).toEqual([]);
    expect(storage.byteReads.filter((path) => path.includes('content'))).toEqual([]);
  });

  it('indexes only newly appended Journal bytes after the initial synchronization', async () => {
    const storage = new CountingObservabilityStorage();
    const firstTraceId = '00000000-0000-4000-8000-000000000011';
    const secondTraceId = '00000000-0000-4000-8000-000000000012';
    const path = segmentPath('2026-08-26', 1);
    seedSegment(storage, '2026-08-26', 1, [started(firstTraceId, 1), ended(firstTraceId, 2)]);
    const reader = createTraceReader({
      rootDirectory: 'observability',
      storage,
      index: new MemoryTraceIndex(),
    });
    await reader.listTraces();
    const previousSize = (await storage.stat(path))?.size ?? 0;
    await storage.appendText(path, `${[
      started(secondTraceId, 1),
      ended(secondTraceId, 2),
    ].map(encodeTraceJournalRecord).join('\n')}\n`);
    storage.resetReads();

    const traces = await reader.listTraces();

    expect(traces.map((trace) => trace.traceId)).toEqual([firstTraceId, secondTraceId]);
    expect(storage.rangeReads.length).toBeGreaterThan(0);
    expect(storage.rangeReads.every((read) => read.offset >= previousSize)).toBe(true);
    storage.resetReads();
    await reader.listTraces();
    expect(storage.rangeReads).toEqual([]);
  });

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
    expect(detail?.spans.find((span) => span.spanId === secondChildId)?.metadata)
      .toEqual({ kind: 'tool_call', toolName: 'write_file' });
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

  it('keeps the recorded business outcome while marking structural evidence gaps incomplete', async () => {
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

    expect(detail?.status).toBe('error');
    expect(detail?.diagnostics).toBe('incomplete');
    expect(detail?.recordedOutcome).toEqual({
      status: 'error',
      code: 'model_failed',
      message: 'Model failed.',
    });
    expect(detail?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'sequence_gap',
      'missing_span_end',
      'invalid_parent',
    ]));
    expect(detail?.issues).not.toContainEqual(expect.objectContaining({ code: 'missing_content' }));
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

  it('defers stored Content integrity checks until that body is explicitly read', async () => {
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

    expect(detail?.status).toBe('ok');
    expect(detail?.diagnostics).toBe('complete');
    expect(detail?.recordedOutcome).toEqual({ status: 'ok' });
    expect(detail?.issues).not.toContainEqual(expect.objectContaining({ code: 'content_hash_mismatch' }));
    await expect(reader.readContent(contentId)).resolves.toEqual({ status: 'corrupt' });
  });

  it('reports unavailable nested fields as partial capture without declaring the Content unavailable', async () => {
    const storage = new ObservabilityMemoryStorage();
    const traceId = '00000000-0000-4000-8000-000000000204';
    const value = 'provider request';
    const records: TraceJournalRecord[] = [
      started(traceId, 1),
      {
        ...base(traceId, 2),
        type: 'content.recorded',
        kind: 'model.provider_request',
        content: {
          mode: 'inline',
          contentId: sha256(new TextEncoder().encode(value)),
          mediaType: 'text/plain;charset=utf-8',
          value,
          issues: [
            { path: '/prompt_cache_key', kind: 'unavailable', reason: 'unsupported_value' },
            { path: '/prompt_cache_retention', kind: 'unavailable', reason: 'unsupported_value' },
          ],
        },
        correlation: {},
      },
      {
        ...base(traceId, 3),
        type: 'trace.ended',
        outcome: { status: 'ok', code: 'completed' },
        diagnostics: 'complete',
      },
    ];
    seedSegment(storage, '2026-08-26', 1, records);
    const reader = createTraceReader({ rootDirectory: 'observability', storage });

    const detail = await reader.getTrace(traceId);

    expect(detail).toMatchObject({ status: 'ok', diagnostics: 'incomplete' });
    expect(detail?.issues).toContainEqual({
      code: 'partial_content_capture',
      sequence: 2,
      contentKind: 'model.provider_request',
      captureIssues: [
        { path: '/prompt_cache_key', kind: 'unavailable', reason: 'unsupported_value' },
        { path: '/prompt_cache_retention', kind: 'unavailable', reason: 'unsupported_value' },
      ],
    });
    expect(detail?.issues).not.toContainEqual(expect.objectContaining({ code: 'unavailable_content' }));
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
      apply: () => { throw new Error('Index unavailable.'); },
      queryTraces: () => { throw new Error('Index unavailable.'); },
      getRecordLocators: () => { throw new Error('Index unavailable.'); },
      readCheckpoints: () => { throw new Error('Index unavailable.'); },
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
    {
      ...spanStarted(traceId, 4, secondChildId, rootSpanId, 'tool.call'),
      metadata: { kind: 'tool_call', toolName: 'write_file' },
    },
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

function storedContent(
  traceId: string,
  sequence: number,
  contentId: string,
  byteLength: number,
): TraceJournalRecord {
  return {
    ...base(traceId, sequence),
    type: 'content.recorded',
    kind: 'model.response',
    content: {
      mode: 'stored',
      contentId,
      mediaType: 'text/plain;charset=utf-8',
      byteLength,
    },
    correlation: {},
  };
}

function ended(traceId: string, sequence: number): TraceJournalRecord {
  return {
    ...base(traceId, sequence),
    type: 'trace.ended',
    outcome: { status: 'ok' },
    diagnostics: 'complete',
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

class CountingObservabilityStorage extends ObservabilityMemoryStorage {
  readonly textReads: string[] = [];
  readonly byteReads: string[] = [];
  readonly rangeReads: Array<{ readonly path: string; readonly offset: number; readonly length: number }> = [];

  override async readText(filePath: string): Promise<string> {
    this.textReads.push(filePath);
    return super.readText(filePath);
  }

  override async readBytes(filePath: string): Promise<Uint8Array> {
    this.byteReads.push(filePath);
    return super.readBytes(filePath);
  }

  override async readBytesRange(
    filePath: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    this.rangeReads.push({ path: filePath, offset, length });
    return super.readBytesRange(filePath, offset, length);
  }

  resetReads(): void {
    this.textReads.length = 0;
    this.byteReads.length = 0;
    this.rangeReads.length = 0;
  }
}

class MemoryTraceIndex implements TraceIndex {
  private traces = new Map<string, TraceProjection>();
  private records: TraceRecordLocator[] = [];
  private checkpoints: readonly JournalCheckpoint[] = [];

  initialize(): { readonly status: 'ready' } {
    return { status: 'ready' };
  }

  replace(input: {
    readonly traces: readonly TraceProjection[];
    readonly records: readonly TraceRecordLocator[];
    readonly checkpoints: readonly JournalCheckpoint[];
  }): void {
    this.traces = new Map(input.traces.map((trace) => [trace.traceId, trace]));
    this.records = [...input.records];
    this.checkpoints = input.checkpoints;
  }

  apply(input: {
    readonly traces: readonly TraceProjection[];
    readonly records: readonly TraceRecordLocator[];
    readonly checkpoints: readonly JournalCheckpoint[];
  }): void {
    for (const trace of input.traces) this.traces.set(trace.traceId, trace);
    this.records.push(...input.records);
    this.checkpoints = input.checkpoints;
  }

  queryTraces() {
    return [...this.traces.values()].map(summarizeTrace);
  }

  getRecordLocators(traceId: string): readonly TraceRecordLocator[] {
    return this.records.filter((record) => record.traceId === traceId);
  }

  readCheckpoints(): readonly JournalCheckpoint[] {
    return this.checkpoints;
  }

  matchesCheckpoints(checkpoints: readonly JournalCheckpoint[]): boolean {
    return JSON.stringify(this.checkpoints) === JSON.stringify(checkpoints);
  }

  async prune(): Promise<void> {
    return undefined;
  }
}
