/*
 * Verifies the renderer-safe Trace diagnostics contract and lazy Content boundary.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ObservabilityQueries, TraceProjection } from '@megumi/observability';
import { createObservabilityOperations } from '@megumi/product-host/operations';

const TRACE_ID = '00000000-0000-4000-8000-000000000001';
const CONTENT_ID = 'a'.repeat(64);

describe('ObservabilityHost', () => {
  it('lists product Trace metadata with fixed filters and no Content body', async () => {
    const queries = queryFixture();
    const host = createObservabilityOperations({ queries, flush: async () => undefined });

    const result = await host.listTraces({
      traceKind: 'conversation',
      status: 'ok',
      startedAtOrAfter: '2026-08-26T00:00:00.000Z',
      correlation: { sessionId: 'session:1', workspaceId: 'workspace:1' },
      limit: 50,
    });

    expect(queries.listTraces).toHaveBeenCalledWith({
      traceKind: 'conversation',
      status: 'ok',
      startedAtOrAfter: '2026-08-26T00:00:00.000Z',
      correlation: { sessionId: 'session:1', workspaceId: 'workspace:1' },
      limit: 50,
    });
    expect(result).toEqual({
      status: 'ok',
      traces: [expect.objectContaining({
        traceId: TRACE_ID,
        traceKind: 'conversation',
        status: 'ok',
        diagnostics: 'complete',
        correlation: expect.objectContaining({ sessionId: 'session:1', executionId: 'execution:1' }),
        spanCount: 1,
        eventCount: 1,
        contentCount: 2,
      })],
    });
    expect(JSON.stringify(result)).not.toContain('actual prompt');
  });

  it('returns a sequence timeline without embedding inline or stored Content bodies', async () => {
    const queries = queryFixture();
    const host = createObservabilityOperations({ queries, flush: async () => undefined });

    const result = await host.getTrace({ traceId: TRACE_ID });

    expect(queries.getTrace).toHaveBeenCalledWith(TRACE_ID);
    expect(result).toMatchObject({
      status: 'found',
      trace: {
        summary: { traceId: TRACE_ID },
        spans: [{
          spanId: 'span:1',
          name: 'model.call',
          events: [{ sequence: 3, type: 'model.output.started' }],
        }],
        contents: [
          { sequence: 4, kind: 'prompt.final', mode: 'inline', contentId: CONTENT_ID },
          { sequence: 5, kind: 'model.provider_response', mode: 'stored', byteLength: 4 },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('actual prompt');
    expect(queries.readContent).not.toHaveBeenCalled();
  });

  it('reads only the selected Content record and preserves binary metadata', async () => {
    const queries = queryFixture();
    const host = createObservabilityOperations({ queries, flush: async () => undefined });

    const inline = await host.getContent({ traceId: TRACE_ID, sequence: 4 });
    const stored = await host.getContent({ traceId: TRACE_ID, sequence: 5 });

    expect(inline).toEqual({
      status: 'available',
      content: {
        encoding: 'text',
        contentId: CONTENT_ID,
        mediaType: 'text/plain;charset=utf-8',
        byteLength: 13,
        text: 'actual prompt',
      },
    });
    expect(stored).toEqual({
      status: 'available',
      content: {
        encoding: 'binary',
        contentId: 'b'.repeat(64),
        mediaType: 'application/octet-stream',
        byteLength: 4,
      },
    });
    expect(queries.readContent).toHaveBeenCalledOnce();
    expect(queries.readContent).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('serializes inline JSON with the same canonical bytes used by Content identity', async () => {
    const queries = queryFixture();
    const trace = projection();
    vi.mocked(queries.getTrace).mockResolvedValue({
      ...trace,
      contents: [...trace.contents, {
        sequence: 6,
        timestamp: '2026-08-26T00:00:00.500Z',
        kind: 'model.request',
        content: {
          mode: 'inline',
          contentId: 'c'.repeat(64),
          mediaType: 'application/json',
          value: { b: 2, a: 1 },
        },
        correlation: { executionId: 'execution:1' },
      }],
    });
    const host = createObservabilityOperations({ queries, flush: async () => undefined });

    await expect(host.getContent({ traceId: TRACE_ID, sequence: 6 })).resolves.toEqual({
      status: 'available',
      content: {
        encoding: 'json', contentId: 'c'.repeat(64), mediaType: 'application/json',
        byteLength: 13, json: '{"a":1,"b":2}',
      },
    });
  });

  it('exposes health, rebuild and Legacy diagnostics as closed results', async () => {
    const queries = queryFixture();
    const host = createObservabilityOperations({ queries, flush: async () => undefined });

    await expect(host.getHealth({})).resolves.toMatchObject({
      status: 'ok',
      health: { droppedRecords: 2, captureFailures: 1 },
    });
    await expect(host.rebuildIndex({})).resolves.toEqual({ status: 'rebuilt' });
    await expect(host.listLegacyDiagnostics({ limit: 10 })).resolves.toEqual({
      status: 'ok',
      diagnostics: [expect.objectContaining({
        kind: 'legacy',
        traceId: 'legacy:1',
        contentAvailable: false,
      })],
    });
  });
});

function queryFixture(): ObservabilityQueries {
  const trace = projection();
  return {
    listTraces: vi.fn(async () => [trace]),
    getTrace: vi.fn(async () => trace),
    readContent: vi.fn(async () => ({
      status: 'available' as const,
      bytes: new Uint8Array([0, 1, 2, 3]),
    })),
    rebuildIndex: vi.fn(async () => true),
    listLegacyDiagnostics: vi.fn(async () => [{
      kind: 'legacy diagnostic' as const,
      traceId: 'legacy:1',
      executionId: 'execution:legacy',
      status: 'incomplete' as const,
      startedAt: '2026-08-25T00:00:00.000Z',
      contentAvailable: false as const,
      records: [],
    }]),
    getHealth: vi.fn(() => ({
      droppedRecords: 2,
      recordsDroppedByType: { content: 1, event: 1, lifecycle: 0, runtime: 0 },
      contentBytesDropped: 128,
      writerQueueHighWaterBytes: 256,
      journalWriteFailures: 0,
      contentWriteFailures: 0,
      flushFailures: 0,
      rotationFailures: 0,
      retentionCleanupFailures: 0,
      indexProjectionFailures: 0,
      classifierFailures: 0,
      contextFailures: 0,
      captureFailures: 1,
    })),
    createDiagnosticBundle: vi.fn(async () => ({ status: 'not_found' as const })),
  };
}

function projection(): TraceProjection {
  return {
    traceId: TRACE_ID,
    traceKind: 'conversation',
    status: 'ok',
    diagnostics: 'complete',
    correlations: [{ requestId: 'request:1', sessionId: 'session:1', workspaceId: 'workspace:1' }, {
      executionId: 'execution:1', sessionId: 'session:1', workspaceId: 'workspace:1',
    }],
    startedAt: '2026-08-26T00:00:00.000Z',
    endedAt: '2026-08-26T00:00:01.000Z',
    recordedOutcome: { status: 'ok', code: 'completed' },
    spans: [{
      spanId: 'span:1',
      name: 'model.call',
      correlation: { executionId: 'execution:1', modelCallId: 'model-call:1' },
      startedAt: '2026-08-26T00:00:00.100Z',
      endedAt: '2026-08-26T00:00:00.900Z',
      outcome: { status: 'ok' },
      events: [{
        sequence: 3,
        timestamp: '2026-08-26T00:00:00.200Z',
        event: { type: 'model.output.started', providerAttempt: 1 },
      }],
    }],
    links: [],
    contents: [{
      sequence: 4,
      timestamp: '2026-08-26T00:00:00.300Z',
      spanId: 'span:1',
      kind: 'prompt.final',
      content: {
        mode: 'inline',
        contentId: CONTENT_ID,
        mediaType: 'text/plain;charset=utf-8',
        value: 'actual prompt',
      },
      correlation: { executionId: 'execution:1' },
    }, {
      sequence: 5,
      timestamp: '2026-08-26T00:00:00.400Z',
      spanId: 'span:1',
      kind: 'model.provider_response',
      content: {
        mode: 'stored',
        contentId: 'b'.repeat(64),
        mediaType: 'application/octet-stream',
        byteLength: 4,
      },
      correlation: { executionId: 'execution:1' },
    }],
    records: [],
    issues: [],
    sourceFiles: ['trace.jsonl'],
  };
}
