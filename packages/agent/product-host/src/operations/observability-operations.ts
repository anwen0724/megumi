/* Exposes Observability queries and coordinates host-owned bundle persistence. */
import type {
  ObservabilityQueries,
  TraceProjection,
} from '@megumi/observability';
import {
  ObservabilityListPayloadSchema,
  ObservabilityRunPayloadSchema,
  type ObservabilityHost,
} from '../host/observability-host';
import type { DiagnosticBundleSaver } from '../host/capabilities/diagnostic-bundle-saver';

/** Creates the Product operations exposed through ObservabilityHost. */
export function createObservabilityOperations(
  request: {
    queries: ObservabilityQueries;
    flush(): Promise<void>;
    save?: DiagnosticBundleSaver;
  },
): ObservabilityHost {
  return {
    async listRecentRunTraces(p) {
      try {
        const payload = ObservabilityListPayloadSchema.parse(p);
        const traces = await request.queries.listTraces(payload);
        return { status: 'ok', traces: traces.map(projectSummary) };
      } catch (error) {
        return { status: 'failed', message: errorMessage(error) };
      }
    },
    async getRunTrace(p) {
      try {
        const payload = ObservabilityRunPayloadSchema.parse(p);
        const trace = await request.queries.getTrace(payload.executionId);
        return trace
          ? {
              status: 'found',
              trace: {
                summary: projectSummary(trace),
                spans: trace.spans.map((span) => ({
                  spanId: span.spanId,
                  ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                  name: span.name,
                  status: span.outcome?.status === 'unavailable'
                    ? 'incomplete'
                    : span.outcome?.status ?? 'incomplete',
                  startedAt: span.startedAt,
                  ...(span.endedAt ? { endedAt: span.endedAt } : {}),
                  ...(durationMs(span.startedAt, span.endedAt) !== undefined
                    ? { durationMs: durationMs(span.startedAt, span.endedAt) }
                    : {}),
                  attributes: {},
                })),
                logs: [],
                measurements: [],
                droppedRecordCount: request.queries.getHealth().droppedRecords,
              },
            }
          : { status: 'not_found' };
      } catch (error) {
        return { status: 'failed', message: errorMessage(error) };
      }
    },
    flush: () => request.flush(),
    exportDiagnosticBundle: async (p) => {
      const payload = ObservabilityRunPayloadSchema.parse(p);
      const result = await request.queries.createDiagnosticBundle(payload.executionId);
      if (result.status === 'not_found') return result;
      if (result.status === 'failed') {
        return { status: 'failed', message: 'Diagnostic bundle creation failed.' };
      }
      return request.save
        ? request.save.save({
            suggestedDirectoryName: result.bundle.suggestedDirectoryName,
            files: result.bundle.files.map((file) => ({
              relativePath: file.relativePath,
              content: file.content,
            })),
          })
        : {
            status: 'failed',
            message: 'Diagnostic bundle save capability is unavailable.',
          };
    },
  };
}

function projectSummary(trace: TraceProjection) {
  const executionId = correlationValue(trace, 'executionId') ?? trace.traceId;
  const sessionId = correlationValue(trace, 'sessionId');
  const workspaceId = correlationValue(trace, 'workspaceId');
  return {
    traceId: trace.traceId,
    executionId,
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    status: trace.status,
    startedAt: trace.startedAt ?? trace.records[0]?.timestamp ?? '',
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    ...(durationMs(trace.startedAt, trace.endedAt) !== undefined
      ? { durationMs: durationMs(trace.startedAt, trace.endedAt) }
      : {}),
    modelCallCount: trace.spans.filter((span) => span.name === 'model.call').length,
    toolCallCount: trace.spans.filter((span) => span.name === 'tool.call').length,
  };
}

function correlationValue(
  trace: TraceProjection,
  key: 'executionId' | 'sessionId' | 'workspaceId',
): string | undefined {
  return trace.correlations.find((correlation) => correlation[key])?.[key];
}

function durationMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Observability query failed.';
}
