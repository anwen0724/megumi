/*
 * Maps Observability Reader projections to closed Product Host DTOs.
 * Business state is deliberately absent; Content is read only by explicit checkpoint selection.
 */
import {
  serializeCapturedContentValue,
  createContentDigest,
  summarizeTrace,
  type DiagnosticJsonValue,
  type ObservabilityQueries,
  type TraceContentProjection,
  type TraceCorrelation,
  type TraceEvent,
  type TraceProjection,
  type TraceSummaryProjection,
} from '@megumi/observability';
import {
  ObservabilityContentPayloadSchema,
  ObservabilityCorrelationSchema,
  ObservabilityEmptyPayloadSchema,
  ObservabilityListPayloadSchema,
  ObservabilityTracePayloadSchema,
  type ObservabilityContentCheckpointUiDto,
  type ObservabilityCorrelationUiDto,
  type ObservabilityEventUiDto,
  type ObservabilityGetContentResult,
  type ObservabilityHost,
  type ObservabilityTraceDetailUiDto,
  type ObservabilityTraceSummaryUiDto,
} from '../host/observability-host';
import type { DiagnosticBundleSaver } from '../host/capabilities/diagnostic-bundle-saver';

/** Creates the Product operations exposed through ObservabilityHost. */
export function createObservabilityOperations(request: {
  queries: ObservabilityQueries;
  flush(): Promise<void>;
  save?: DiagnosticBundleSaver;
}): ObservabilityHost {
  return {
    async listTraces(input) {
      try {
        const payload = ObservabilityListPayloadSchema.parse(input);
        const traces = await request.queries.listTraces(payload);
        return { status: 'ok', traces: traces.map(projectSummary) };
      } catch (error) {
        return failedResult(error);
      }
    },
    async getTrace(input) {
      try {
        const payload = ObservabilityTracePayloadSchema.parse(input);
        const trace = await request.queries.getTrace(payload.traceId);
        return trace
          ? { status: 'found', trace: projectDetail(trace) }
          : { status: 'not_found' };
      } catch (error) {
        return failedResult(error);
      }
    },
    async getContent(input) {
      try {
        const payload = ObservabilityContentPayloadSchema.parse(input);
        const trace = await request.queries.getTrace(payload.traceId);
        const checkpoint = trace?.contents.find((item) => item.sequence === payload.sequence);
        if (!checkpoint) return { status: 'not_found' };
        return readCheckpointContent(checkpoint, request.queries);
      } catch (error) {
        return failedResult(error);
      }
    },
    async getHealth(input) {
      try {
        ObservabilityEmptyPayloadSchema.parse(input);
        return { status: 'ok', health: request.queries.getHealth() };
      } catch (error) {
        return failedResult(error);
      }
    },
    async rebuildIndex(input) {
      try {
        ObservabilityEmptyPayloadSchema.parse(input);
        const rebuilt = await request.queries.rebuildIndex();
        return rebuilt
          ? { status: 'rebuilt' }
          : { status: 'failed', message: 'Trace index rebuild failed.' };
      } catch (error) {
        return failedResult(error);
      }
    },
    flush: () => request.flush(),
    async exportDiagnosticBundle(input) {
      try {
        const payload = ObservabilityTracePayloadSchema.parse(input);
        const result = await request.queries.createDiagnosticBundle(payload.traceId);
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
          : { status: 'failed', message: 'Diagnostic bundle save capability is unavailable.' };
      } catch (error) {
        return failedResult(error);
      }
    },
  };
}

function projectSummary(trace: TraceSummaryProjection): ObservabilityTraceSummaryUiDto {
  const duration = durationMs(trace.startedAt, trace.endedAt);
  return {
    traceId: trace.traceId,
    traceKind: trace.traceKind,
    status: trace.status,
    diagnostics: trace.diagnostics,
    correlation: consolidateCorrelations(trace.correlations),
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    ...(duration === undefined ? {} : { durationMs: duration }),
    spanCount: trace.spanCount,
    eventCount: trace.eventCount,
    contentCount: trace.contentCount,
    issueCount: trace.issueCount,
  };
}

function projectDetail(trace: TraceProjection): ObservabilityTraceDetailUiDto {
  return {
    summary: projectSummary(summarizeTrace(trace)),
    ...(trace.recordedOutcome ? { outcome: trace.recordedOutcome } : {}),
    spans: trace.spans.map((span) => {
      const duration = durationMs(span.startedAt, span.endedAt);
      return {
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        name: span.name,
        ...(span.metadata ? { metadata: { ...span.metadata } } : {}),
        correlation: ObservabilityCorrelationSchema.parse(span.correlation),
        startedAt: span.startedAt,
        ...(span.endedAt ? { endedAt: span.endedAt } : {}),
        ...(duration === undefined ? {} : { durationMs: duration }),
        ...(span.outcome ? { outcome: span.outcome } : {}),
        events: span.events.map((event) => projectEvent(event.sequence, event.timestamp, event.event)),
      };
    }),
    contents: trace.contents.map(projectContentCheckpoint),
    links: trace.links.map((link) => ({
      sequence: link.sequence,
      timestamp: link.timestamp,
      linkKind: link.linkKind,
      targetTraceId: link.targetTraceId,
      ...(link.correlation
        ? { correlation: ObservabilityCorrelationSchema.parse(link.correlation) }
        : {}),
    })),
    issues: trace.issues.map(({ captureIssues, ...issue }) => ({
      ...issue,
      ...(captureIssues
        ? { captureIssues: captureIssues.map((captureIssue) => ({ ...captureIssue })) }
        : {}),
    })),
    sourceFiles: [...trace.sourceFiles],
  };
}

function projectEvent(sequence: number, timestamp: string, event: TraceEvent): ObservabilityEventUiDto {
  const detail: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key !== 'type' && isEventDetailValue(value)) detail[key] = value;
  }
  return { sequence, timestamp, type: event.type, detail };
}

function projectContentCheckpoint(
  checkpoint: TraceContentProjection,
): ObservabilityContentCheckpointUiDto {
  const common = {
    sequence: checkpoint.sequence,
    timestamp: checkpoint.timestamp,
    ...(checkpoint.spanId ? { spanId: checkpoint.spanId } : {}),
    kind: checkpoint.kind,
    mode: checkpoint.content.mode,
    correlation: ObservabilityCorrelationSchema.parse(checkpoint.correlation),
  };
  if (checkpoint.content.mode === 'redacted' || checkpoint.content.mode === 'unavailable') {
    return { ...common, reason: checkpoint.content.reason };
  }
  const issues = checkpoint.content.issues
    ? { issues: checkpoint.content.issues.map((issue) => ({ ...issue })) }
    : {};
  return {
    ...common,
    contentId: checkpoint.content.contentId,
    mediaType: checkpoint.content.mediaType,
    byteLength: checkpoint.content.mode === 'stored'
      ? checkpoint.content.byteLength
      : encodedInline(checkpoint.content.value, checkpoint.content.mediaType).byteLength,
    ...issues,
  };
}

async function readCheckpointContent(
  checkpoint: TraceContentProjection,
  queries: ObservabilityQueries,
): Promise<ObservabilityGetContentResult> {
  const content = checkpoint.content;
  if (content.mode === 'redacted') return { status: 'redacted', reason: content.reason };
  if (content.mode === 'unavailable') return { status: 'unavailable', reason: content.reason };
  if (content.mode === 'inline') {
    const encoded = encodedInline(content.value, content.mediaType);
    if (createContentDigest(content.value) !== content.contentId) {
      return { status: 'unavailable', reason: 'content_hash_mismatch' };
    }
    return {
      status: 'available',
      content: encoded.encoding === 'json'
        ? {
            encoding: 'json', contentId: content.contentId, mediaType: content.mediaType,
            byteLength: encoded.byteLength, json: encoded.value,
          }
        : {
            encoding: 'text', contentId: content.contentId, mediaType: content.mediaType,
            byteLength: encoded.byteLength, text: encoded.value,
          },
    };
  }

  const read = await queries.readContent(content.contentId);
  if (read.status !== 'available') return { status: 'unavailable', reason: read.status };
  if (read.bytes.byteLength !== content.byteLength) {
    return { status: 'unavailable', reason: 'content_length_mismatch' };
  }
  if (!isTextMediaType(content.mediaType)) {
    return {
      status: 'available',
      content: {
        encoding: 'binary', contentId: content.contentId, mediaType: content.mediaType,
        byteLength: read.bytes.byteLength,
      },
    };
  }
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
    return {
      status: 'available',
      content: isJsonMediaType(content.mediaType)
        ? {
            encoding: 'json', contentId: content.contentId, mediaType: content.mediaType,
            byteLength: read.bytes.byteLength, json: value,
          }
        : {
            encoding: 'text', contentId: content.contentId, mediaType: content.mediaType,
            byteLength: read.bytes.byteLength, text: value,
          },
    };
  } catch {
    return { status: 'unavailable', reason: 'invalid_utf8' };
  }
}

function encodedInline(value: DiagnosticJsonValue, mediaType: string): {
  readonly encoding: 'text' | 'json'; readonly value: string; readonly byteLength: number;
} {
  const encoding = isJsonMediaType(mediaType) || typeof value !== 'string' ? 'json' : 'text';
  const serialized = serializeCapturedContentValue(value);
  return { encoding, value: serialized, byteLength: new TextEncoder().encode(serialized).byteLength };
}

function consolidateCorrelations(
  correlations: readonly TraceCorrelation[],
): ObservabilityCorrelationUiDto {
  return ObservabilityCorrelationSchema.parse(Object.assign({}, ...correlations));
}

function durationMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : undefined;
}

function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || isJsonMediaType(mediaType);
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType.startsWith('application/json') || mediaType.includes('+json');
}

function isEventDetailValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function failedResult(error: unknown): { readonly status: 'failed'; readonly message: string } {
  return { status: 'failed', message: error instanceof Error ? error.message : 'Observability query failed.' };
}
