/*
 * Projects native product Trace details into a readable, ordered Evaluation process.
 * It never writes Trace data or infers actions that are absent from Observability.
 */
import type {
  ObservabilityCorrelationUiDto,
  ObservabilityTraceDetailUiDto,
} from '@megumi/product-host/host';
import { z } from 'zod';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const ExecutionProcessContentRefSchema = z.object({
  traceId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.string().min(1),
}).strict();

export const ExecutionProcessStepSchema = z.object({
  sequence: z.number().int().nonnegative(),
  category: z.enum([
    'context',
    'prompt',
    'model',
    'tool',
    'source',
    'retry',
    'business_settlement',
  ]),
  name: z.string().min(1),
  status: z.string().min(1).optional(),
  timestamp: z.string().min(1),
  durationMs: z.number().nonnegative().optional(),
  spanId: z.string().min(1).optional(),
  eventTypes: z.array(z.string().min(1)),
  contentRefs: z.array(ExecutionProcessContentRefSchema),
}).strict();

export const ExecutionProcessTraceSchema = z.object({
  traceId: z.string().min(1),
  traceKind: z.string().min(1),
  status: z.string().min(1),
  diagnostics: z.string().min(1),
  correlation: JsonRecordSchema,
  startedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  steps: z.array(ExecutionProcessStepSchema),
}).strict();

export const ExecutionProcessAttemptSchema = z.object({
  attemptId: z.string().min(1),
  executionId: z.string().min(1).optional(),
  businessIds: z.record(z.string(), z.union([z.string(), z.number()])),
  traces: z.array(ExecutionProcessTraceSchema).min(1),
}).strict();

export const ExecutionProcessSchema = z.object({
  attempts: z.array(ExecutionProcessAttemptSchema),
  issues: z.array(z.object({
    traceId: z.string().min(1),
    code: z.string().min(1),
    sequence: z.number().int().nonnegative().optional(),
  }).strict()),
}).strict();

export type ExecutionProcess = z.infer<typeof ExecutionProcessSchema>;
export type ExecutionProcessStep = z.infer<typeof ExecutionProcessStepSchema>;

/** Groups Trace details by real execution ID and preserves sequence only inside each Trace. */
export function projectExecutionProcess(
  traces: readonly ObservabilityTraceDetailUiDto[],
): ExecutionProcess {
  const attempts = new Map<string, {
    attemptId: string;
    executionId?: string;
    businessIds: Record<string, string | number>;
    traces: z.infer<typeof ExecutionProcessTraceSchema>[];
  }>();

  for (const trace of traces) {
    const executionId = trace.summary.correlation.executionId;
    const attemptId = executionId ?? trace.summary.traceId;
    const attempt = attempts.get(attemptId) ?? {
      attemptId,
      ...(executionId ? { executionId } : {}),
      businessIds: {},
      traces: [],
    };
    Object.assign(attempt.businessIds, businessIds(trace.summary.correlation));
    attempt.traces.push(projectTrace(trace));
    attempts.set(attemptId, attempt);
  }

  return ExecutionProcessSchema.parse({
    attempts: [...attempts.values()],
    issues: traces.flatMap((trace) => trace.issues.map((issue) => ({
      traceId: trace.summary.traceId,
      code: issue.code,
      ...(issue.sequence !== undefined ? { sequence: issue.sequence } : {}),
    }))),
  });
}

function projectTrace(
  trace: ObservabilityTraceDetailUiDto,
): z.infer<typeof ExecutionProcessTraceSchema> {
  const knownSpanIds = new Set(trace.spans.map(({ spanId }) => spanId));
  const steps: ExecutionProcessStep[] = trace.spans.flatMap((span) => {
    const contents = trace.contents.filter(({ spanId }) => spanId === span.spanId);
    const sequences = [
      ...span.events.map(({ sequence }) => sequence),
      ...contents.map(({ sequence }) => sequence),
    ];
    const sequence = minimum(sequences);
    if (sequence === undefined) return [];
    const firstTimestamp = [
      ...span.events.map(({ timestamp, sequence: itemSequence }) => ({ timestamp, sequence: itemSequence })),
      ...contents.map(({ timestamp, sequence: itemSequence }) => ({ timestamp, sequence: itemSequence })),
    ].sort((left, right) => left.sequence - right.sequence)[0]?.timestamp;
    return [{
      sequence,
      category: spanCategory(span.name),
      name: span.metadata?.kind === 'tool_call' ? span.metadata.toolName : span.name,
      ...(span.outcome?.status ? { status: span.outcome.status } : {}),
      timestamp: firstTimestamp ?? span.startedAt,
      ...(span.durationMs !== undefined ? { durationMs: span.durationMs } : {}),
      spanId: span.spanId,
      eventTypes: span.events.map(({ type }) => type),
      contentRefs: contents
        .map(({ sequence: contentSequence, kind }) => ({
          traceId: trace.summary.traceId,
          sequence: contentSequence,
          kind,
        }))
        .sort((left, right) => left.sequence - right.sequence),
    }];
  });

  steps.push(...trace.contents
    .filter(({ spanId }) => !spanId || !knownSpanIds.has(spanId))
    .map((content) => ({
      sequence: content.sequence,
      category: contentCategory(content.kind),
      name: content.kind,
      status: content.mode,
      timestamp: content.timestamp,
      eventTypes: [],
      contentRefs: [{
        traceId: trace.summary.traceId,
        sequence: content.sequence,
        kind: content.kind,
      }],
    })));

  steps.push(...trace.links
    .filter(({ linkKind }) => linkKind === 'retries')
    .map((link) => ({
      sequence: link.sequence,
      category: 'retry' as const,
      name: 'trace.retries',
      status: 'recorded',
      timestamp: link.timestamp,
      eventTypes: [],
      contentRefs: [],
    })));

  steps.sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
  return ExecutionProcessTraceSchema.parse({
    traceId: trace.summary.traceId,
    traceKind: trace.summary.traceKind,
    status: trace.summary.status,
    diagnostics: trace.summary.diagnostics,
    correlation: trace.summary.correlation,
    startedAt: trace.summary.startedAt,
    durationMs: trace.summary.durationMs,
    steps,
  });
}

function spanCategory(name: string): ExecutionProcessStep['category'] {
  if (name.startsWith('context.')) return 'context';
  if (name.startsWith('prompt.')) return 'prompt';
  if (name.startsWith('model.')) return 'model';
  if (name.startsWith('tool.') || name.startsWith('permission.')) return 'tool';
  if (name.startsWith('source.')) return 'source';
  return 'business_settlement';
}

function contentCategory(kind: string): ExecutionProcessStep['category'] {
  if (kind.startsWith('context.')) return 'context';
  if (kind === 'prompt.final' || kind.startsWith('prompt.')) return 'prompt';
  if (kind.startsWith('model.')) return 'model';
  if (kind.startsWith('tool.') || kind.startsWith('permission.')) return 'tool';
  if (kind.startsWith('source.')) return 'source';
  if (kind.includes('retry')) return 'retry';
  return 'business_settlement';
}

function businessIds(correlation: ObservabilityCorrelationUiDto): Record<string, string | number> {
  const omitted = new Set(['modelCallId', 'toolCallId', 'contentId', 'contentDigest', 'providerAttempt']);
  return Object.fromEntries(Object.entries(correlation).filter(
    (entry): entry is [string, string | number] => (
      !omitted.has(entry[0]) && (typeof entry[1] === 'string' || typeof entry[1] === 'number')
    ),
  ));
}

function minimum(values: readonly number[]): number | undefined {
  return values.length > 0 ? Math.min(...values) : undefined;
}
