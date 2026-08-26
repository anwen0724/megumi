// @vitest-environment node
/* Verifies metadata-only Derived Index filtering, checkpoints, pruning, and rebuild semantics. */
import { createDatabase, type DatabaseRow } from '@megumi/database';
import { afterEach, describe, expect, it } from 'vitest';
import { createTraceIndex, type JournalCheckpoint } from '../../../packages/agent/observability/src/persistence/trace-index';
import { projectTrace } from '../../../packages/agent/observability/src/query/trace-projector';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('Trace Index', () => {
  it('filters every metadata dimension and expands recommendationIds without storing content bodies', () => {
    const database = openMemoryDatabase();
    const index = createTraceIndex({ database });
    expect(index.initialize()).toEqual({ status: 'rebuilt' });
    const trace = indexedTrace();
    const checkpoint: JournalCheckpoint = {
      filePath: 'observability/traces/trace-v1-2026-08-26-0001.jsonl',
      size: 1234,
      modifiedAtMs: 10,
    };
    index.replace({ traces: [trace], checkpoints: [checkpoint] });

    expect(index.queryTraceIds({ traceKind: 'daily_discovery' })).toEqual([trace.traceId]);
    expect(index.queryTraceIds({ status: 'ok' })).toEqual([trace.traceId]);
    expect(index.queryTraceIds({ spanName: 'source.search' })).toEqual([trace.traceId]);
    expect(index.queryTraceIds({ contentKind: 'source.result' })).toEqual([trace.traceId]);
    const correlationQueries = [
      { requestId: 'request-1' },
      { executionId: 'execution-1' },
      { sessionId: 'session-1' },
      { messageId: 'message-1' },
      { workspaceId: 'workspace-1' },
      { batchId: 'batch-1' },
      { compactionId: 'compaction-1' },
      { modelCallId: 'model-call-1' },
      { toolCallId: 'tool-call-1' },
      { sourceId: 'source-1' },
      { candidateId: 'candidate-1' },
      { recommendationId: 'recommendation-1' },
      { contentId: 'a'.repeat(64) },
      { contentDigest: 'b'.repeat(64) },
      { providerAttempt: 1 },
      { discoveryAttempt: 2 },
    ] as const;
    for (const correlation of correlationQueries) {
      expect(index.queryTraceIds({ correlation })).toEqual([trace.traceId]);
    }
    expect(index.queryTraceIds({
      correlation: { executionId: 'execution-1', modelCallId: 'model-call-2' },
    })).toEqual([trace.traceId]);
    expect(index.queryTraceIds({ correlation: { recommendationIds: ['recommendation-2'] } })).toEqual([
      trace.traceId,
    ]);
    expect(index.queryTraceIds({ startedAtOrAfter: '2026-08-26T00:00:00.000Z' })).toEqual([
      trace.traceId,
    ]);
    expect(index.matchesCheckpoints([checkpoint])).toBe(true);
    expect(index.matchesCheckpoints([{ ...checkpoint, size: 999 }])).toBe(false);

    const contentRow = database.prepare({ sql: 'SELECT * FROM contents LIMIT 1' }).get();
    expect(contentRow).toBeDefined();
    expect(contentRow).not.toHaveProperty('value');
    expect(contentRow).not.toHaveProperty('body');
    const recommendationRows = database.prepare<CountRow>({
      sql: "SELECT COUNT(*) AS count FROM correlations WHERE key = 'recommendationIds'",
    }).get();
    expect(recommendationRows?.count).toBe(2);
  });

  it('rebuilds incompatible schema and prunes projections from removed Journal sources', async () => {
    const database = openMemoryDatabase();
    const index = createTraceIndex({ database });
    index.initialize();
    const trace = indexedTrace();
    const checkpoint: JournalCheckpoint = {
      filePath: 'observability/traces/trace-v1-2026-08-26-0001.jsonl',
      size: 1234,
      modifiedAtMs: 10,
    };
    index.replace({ traces: [trace], checkpoints: [checkpoint] });

    await index.prune({ retainedJournalPaths: [] });
    expect(index.queryTraceIds({})).toEqual([]);

    database.prepare({ sql: 'UPDATE observability_index_meta SET schema_version = 999' }).run();
    expect(index.initialize()).toEqual({ status: 'rebuilt' });
    expect(index.queryTraceIds({})).toEqual([]);
  });
});

function openMemoryDatabase() {
  const database = createDatabase({ filename: ':memory:' });
  databases.push(database);
  return database;
}

interface CountRow extends DatabaseRow {
  readonly count: number;
}

function indexedTrace() {
  const traceId = '00000000-0000-4000-8000-000000000501';
  const spanId = '00000000-0000-4000-8000-000000000510';
  const records: TraceJournalRecord[] = [
    {
      ...base(traceId, 1),
      type: 'trace.started',
      traceKind: 'daily_discovery',
      correlation: {
        requestId: 'request-1',
        executionId: 'execution-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        batchId: 'batch-1',
        compactionId: 'compaction-1',
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-1',
        sourceId: 'source-1',
        candidateId: 'candidate-1',
        recommendationId: 'recommendation-1',
        recommendationIds: ['recommendation-1', 'recommendation-2'],
        contentId: 'a'.repeat(64),
        contentDigest: 'b'.repeat(64),
        providerAttempt: 1,
        discoveryAttempt: 2,
      },
    },
    {
      ...base(traceId, 2),
      type: 'span.started',
      spanId,
      name: 'source.search',
      correlation: { modelCallId: 'model-call-2' },
    },
    {
      ...base(traceId, 3),
      type: 'content.recorded',
      spanId,
      kind: 'source.result',
      content: {
        mode: 'inline',
        contentId: 'c'.repeat(64),
        mediaType: 'application/json',
        value: { title: 'body not copied into the index' },
      },
      correlation: {},
    },
    {
      ...base(traceId, 4),
      type: 'span.ended',
      spanId,
      outcome: { status: 'ok' },
    },
    {
      ...base(traceId, 5),
      type: 'trace.ended',
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    },
  ];
  return projectTrace({
    traceId,
    records,
    sourceFiles: ['observability/traces/trace-v1-2026-08-26-0001.jsonl'],
  });
}

function base(traceId: string, sequence: number) {
  return {
    schemaVersion: 1 as const,
    recordId: `00000000-0000-4000-8000-${String(600 + sequence).padStart(12, '0')}`,
    traceId,
    sequence,
    timestamp: `2026-08-26T00:00:0${sequence}.000Z`,
  };
}
