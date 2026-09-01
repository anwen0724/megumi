/*
 * Resolves typed Evaluation Trace targets through Product Host and projects
 * selected Trace Content and Measurements into stable Evidence partitions.
 */
import type { ProductRuntime } from '@megumi/composition';
import {
  ObservabilityCorrelationSchema,
  type ObservabilityCorrelationUiDto,
} from '@megumi/product-host';
import { z } from 'zod';

const TraceKindSchema = z.enum([
  'conversation',
  'interest_understanding',
  'candidate_supply',
  'daily_recommendation',
  'preference_learning',
]);

export const TraceTargetSchema: z.ZodType<TraceTarget> = z.object({
  traceKind: TraceKindSchema,
  correlation: ObservabilityCorrelationSchema,
  expectation: z.enum(['required', 'conditional']),
}).strict();
export interface TraceTarget {
  readonly traceKind: z.infer<typeof TraceKindSchema>;
  readonly correlation: ObservabilityCorrelationUiDto;
  readonly expectation: 'required' | 'conditional';
}

export const TraceEvidenceContentSchema = z.object({
  traceId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.string().min(1),
  status: z.enum(['available', 'redacted', 'unavailable']),
  encoding: z.enum(['text', 'json', 'binary']).optional(),
  mediaType: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional(),
  body: z.string().optional(),
  reason: z.string().optional(),
}).strict();
export type TraceEvidenceContent = z.infer<typeof TraceEvidenceContentSchema>;

export const TraceContentPartitionsSchema = z.object({
  input: z.array(TraceEvidenceContentSchema),
  context: z.array(TraceEvidenceContentSchema),
  execution: z.array(TraceEvidenceContentSchema),
  output: z.array(TraceEvidenceContentSchema),
}).strict();
export type TraceContentPartitions = z.infer<typeof TraceContentPartitionsSchema>;

export interface TraceEvidenceIssue {
  readonly code: 'trace_query_failed' | 'correlated_trace_missing' | 'trace_incomplete';
  readonly source: 'trace';
  readonly message: string;
  readonly impact: 'diagnostic_only' | 'not_gradable';
}

export interface TraceMeasurementProjection {
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly sourceCalls: number;
  readonly retries: number;
  readonly estimatedCostUsd: number;
  readonly unavailable: readonly TraceMeasurementName[];
}

export type TraceMeasurementName =
  | 'inputTokens'
  | 'outputTokens'
  | 'modelCalls'
  | 'toolCalls'
  | 'sourceCalls'
  | 'retries'
  | 'estimatedCostUsd';

export interface CollectedTraceEvidence {
  readonly traceIds: readonly string[];
  readonly traceSummaries: readonly Readonly<Record<string, unknown>>[];
  readonly content: TraceContentPartitions;
  readonly measurements: TraceMeasurementProjection;
  readonly issues: readonly TraceEvidenceIssue[];
}

const TRACE_SETTLEMENT_TIMEOUT_MS = 2_000;
const TRACE_SETTLEMENT_POLL_MS = 25;
const TRACE_MEASUREMENT_NAMES: readonly TraceMeasurementName[] = [
  'inputTokens',
  'outputTokens',
  'modelCalls',
  'toolCalls',
  'sourceCalls',
  'retries',
  'estimatedCostUsd',
];

/** Flushes, settles, and reads only the Trace targets declared by the executed business operation. */
export async function collectTraceEvidence(input: {
  readonly runtime: ProductRuntime;
  readonly targets: readonly TraceTarget[];
  readonly settlementTimeoutMs?: number;
}): Promise<CollectedTraceEvidence> {
  const targets = input.targets.map((target) => TraceTargetSchema.parse(target));
  if (targets.length === 0) return emptyTraceEvidence();

  const deadline = Date.now() + (input.settlementTimeoutMs ?? TRACE_SETTLEMENT_TIMEOUT_MS);
  const traceById = new Map<string, TraceDetail>();
  const resolvedTargets = new Set<number>();
  const failedTargets = new Set<number>();
  const issues: TraceEvidenceIssue[] = [];
  let completedPass = false;

  while (
    !completedPass
    || (Date.now() <= deadline && hasPendingRequiredTarget(targets, resolvedTargets, failedTargets))
  ) {
    try {
      await input.runtime.host.observability.flush();
    } catch (error) {
      pushUniqueIssue(issues, queryFailure('Trace flush failed.', error));
      targets.forEach((_, index) => failedTargets.add(index));
      break;
    }

    for (const [index, target] of targets.entries()) {
      if (resolvedTargets.has(index) || failedTargets.has(index)) continue;
      const listed = await input.runtime.host.observability.listTraces({
        traceKind: target.traceKind,
        correlation: target.correlation,
        limit: 20,
      });
      if (listed.status === 'failed') {
        failedTargets.add(index);
        pushUniqueIssue(issues, queryFailure(`Trace list failed for ${target.traceKind}.`, listed.message));
        continue;
      }
      if (listed.traces.length === 0) continue;

      let targetResolved = false;
      for (const summary of listed.traces) {
        if (traceById.has(summary.traceId)) {
          targetResolved = true;
          continue;
        }
        const result = await input.runtime.host.observability.getTrace({ traceId: summary.traceId });
        if (result.status === 'found') {
          traceById.set(summary.traceId, result.trace);
          targetResolved = true;
          continue;
        }
        if (result.status === 'failed') {
          failedTargets.add(index);
          pushUniqueIssue(issues, queryFailure(`Trace read failed: ${summary.traceId}.`, result.message));
        }
      }
      if (targetResolved) resolvedTargets.add(index);
    }
    completedPass = true;

    if (hasPendingRequiredTarget(targets, resolvedTargets, failedTargets)) {
      await waitForNextPoll(deadline);
    }
  }

  targets.forEach((target, index) => {
    if (target.expectation === 'required' && !resolvedTargets.has(index) && !failedTargets.has(index)) {
      pushUniqueIssue(issues, {
        code: 'correlated_trace_missing',
        source: 'trace',
        message: `Required ${target.traceKind} Trace did not settle before the Evaluation deadline.`,
        impact: 'diagnostic_only',
      });
    }
  });

  const traces = [...traceById.values()];
  for (const trace of traces) {
    if (trace.summary.diagnostics === 'incomplete') {
      pushUniqueIssue(issues, {
        code: 'trace_incomplete',
        source: 'trace',
        message: `Trace reports incomplete diagnostic capture: ${trace.summary.traceId}.`,
        impact: 'diagnostic_only',
      });
    }
  }

  const [content, measurements] = await Promise.all([
    collectContent(input.runtime, traces, issues),
    collectMeasurements(input.runtime, traces, targets, resolvedTargets, failedTargets, issues),
  ]);
  return {
    traceIds: traces.map(({ summary }) => summary.traceId),
    traceSummaries: traces.map(summarizeTrace),
    content,
    measurements,
    issues,
  };
}

type TraceReadResult = Awaited<ReturnType<ProductRuntime['host']['observability']['getTrace']>>;
type TraceDetail = Extract<TraceReadResult, { readonly status: 'found' }>['trace'];

async function collectContent(
  runtime: ProductRuntime,
  traces: readonly TraceDetail[],
  issues: TraceEvidenceIssue[],
): Promise<TraceContentPartitions> {
  const partitions: MutableTraceContentPartitions = { input: [], context: [], execution: [], output: [] };
  for (const trace of traces) {
    for (const checkpoint of trace.contents) {
      const result = await runtime.host.observability.getContent({
        traceId: trace.summary.traceId,
        sequence: checkpoint.sequence,
      });
      const projected = projectContent(trace.summary.traceId, checkpoint, result, issues);
      if (projected) partitions[contentPartition(checkpoint.kind)].push(projected);
    }
  }
  return partitions;
}

type ContentReadResult = Awaited<ReturnType<ProductRuntime['host']['observability']['getContent']>>;

function projectContent(
  traceId: string,
  checkpoint: TraceDetail['contents'][number],
  result: ContentReadResult,
  issues: TraceEvidenceIssue[],
): TraceEvidenceContent | undefined {
  if (result.status === 'available') {
    return TraceEvidenceContentSchema.parse({
      traceId,
      sequence: checkpoint.sequence,
      kind: checkpoint.kind,
      status: 'available',
      encoding: result.content.encoding,
      mediaType: result.content.mediaType,
      byteLength: result.content.byteLength,
      ...('text' in result.content ? { body: result.content.text } : {}),
      ...('json' in result.content ? { body: result.content.json } : {}),
    });
  }
  if (result.status === 'redacted' || result.status === 'unavailable') {
    return {
      traceId,
      sequence: checkpoint.sequence,
      kind: checkpoint.kind,
      status: result.status,
      reason: result.reason,
    };
  }
  if (result.status === 'failed') {
    pushUniqueIssue(issues, queryFailure(`Trace Content read failed: ${traceId}#${checkpoint.sequence}.`, result.message));
    return undefined;
  }
  pushUniqueIssue(issues, {
    code: 'trace_incomplete',
    source: 'trace',
    message: `Trace Content is missing: ${traceId}#${checkpoint.sequence}.`,
    impact: 'diagnostic_only',
  });
  return undefined;
}

async function collectMeasurements(
  runtime: ProductRuntime,
  traces: readonly TraceDetail[],
  targets: readonly TraceTarget[],
  resolvedTargets: ReadonlySet<number>,
  failedTargets: ReadonlySet<number>,
  issues: TraceEvidenceIssue[],
): Promise<TraceMeasurementProjection> {
  const aggregate = mutableEmptyMeasurements();
  const unavailable = new Set<TraceMeasurementName>();
  const requiredUnavailable = targets.some((target, index) => (
    target.expectation === 'required' && (!resolvedTargets.has(index) || failedTargets.has(index))
  ));
  if (requiredUnavailable) TRACE_MEASUREMENT_NAMES.forEach((name) => unavailable.add(name));

  for (const trace of traces) {
    const result = await runtime.host.observability.getTraceMeasurements({ traceId: trace.summary.traceId });
    if (result.status !== 'found') {
      TRACE_MEASUREMENT_NAMES.forEach((name) => unavailable.add(name));
      if (result.status === 'failed') {
        pushUniqueIssue(issues, queryFailure(`Trace Measurement read failed: ${trace.summary.traceId}.`, result.message));
      } else {
        pushUniqueIssue(issues, {
          code: 'trace_incomplete',
          source: 'trace',
          message: `Trace Measurement is missing: ${trace.summary.traceId}.`,
          impact: 'diagnostic_only',
        });
      }
      continue;
    }
    const measurement = result.measurements;
    aggregate.durationMs += measurement.durationMs ?? 0;
    aggregate.inputTokens += measurement.usage.inputTokens;
    aggregate.outputTokens += measurement.usage.outputTokens;
    aggregate.modelCalls += measurement.modelCalls;
    aggregate.toolCalls += measurement.toolCalls;
    aggregate.sourceCalls += measurement.sourceCalls;
    aggregate.retries += measurement.retries;
    aggregate.estimatedCostUsd += measurement.usage.estimatedCostUsd;
    if (measurement.issues.some(({ code }) => (
      code === 'model_usage_missing' || code === 'model_usage_unavailable'
    ))) {
      unavailable.add('inputTokens');
      unavailable.add('outputTokens');
      unavailable.add('estimatedCostUsd');
    }
  }
  return { ...aggregate, unavailable: [...unavailable] };
}

function summarizeTrace(trace: TraceDetail): Readonly<Record<string, unknown>> {
  return {
    traceId: trace.summary.traceId,
    traceKind: trace.summary.traceKind,
    status: trace.summary.status,
    diagnostics: trace.summary.diagnostics,
    correlation: trace.summary.correlation,
    startedAt: trace.summary.startedAt,
    durationMs: trace.summary.durationMs,
    issueCount: trace.summary.issueCount,
    spans: trace.spans.map((span) => ({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      outcome: span.outcome,
      durationMs: span.durationMs,
      metadata: span.metadata,
    })),
  };
}

type ContentPartition = keyof TraceContentPartitions;
type MutableTraceContentPartitions = { [Key in ContentPartition]: TraceEvidenceContent[] };

function contentPartition(kind: string): ContentPartition {
  if (kind.startsWith('input.') || kind.startsWith('session.message.')) return 'input';
  if (kind.startsWith('context.') || kind === 'prompt.final') return 'context';
  if (
    kind === 'model.response'
    || kind === 'recommendation.published'
    || kind.startsWith('preference.')
    || kind.startsWith('interest.')
  ) return 'output';
  return 'execution';
}

function hasPendingRequiredTarget(
  targets: readonly TraceTarget[],
  resolved: ReadonlySet<number>,
  failed: ReadonlySet<number>,
): boolean {
  return targets.some((target, index) => (
    target.expectation === 'required' && !resolved.has(index) && !failed.has(index)
  ));
}

async function waitForNextPoll(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(TRACE_SETTLEMENT_POLL_MS, remaining)));
}

function queryFailure(message: string, detail: unknown): TraceEvidenceIssue {
  const suffix = detail instanceof Error ? detail.message : String(detail);
  return {
    code: 'trace_query_failed',
    source: 'trace',
    message: `${message} ${suffix}`.trim(),
    impact: 'not_gradable',
  };
}

function pushUniqueIssue(issues: TraceEvidenceIssue[], issue: TraceEvidenceIssue): void {
  if (!issues.some((candidate) => candidate.code === issue.code && candidate.message === issue.message)) {
    issues.push(issue);
  }
}

function mutableEmptyMeasurements() {
  return {
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
    sourceCalls: 0,
    retries: 0,
    estimatedCostUsd: 0,
  };
}

function emptyTraceEvidence(): CollectedTraceEvidence {
  return {
    traceIds: [],
    traceSummaries: [],
    content: { input: [], context: [], execution: [], output: [] },
    measurements: { ...mutableEmptyMeasurements(), unavailable: [] },
    issues: [],
  };
}
