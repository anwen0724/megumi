/*
 * Projects one real product execution into compact, gradable facts and native Trace references.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import { z } from 'zod';
import { EvaluationOperationSchema, EvaluationProfileSchema, type EvaluationTask } from '../contracts/evaluation-task';
import type { ProductTaskExecution } from './execute-task';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const ObservationIssueSchema = z.object({
  code: z.string().min(1),
  source: z.enum(['product', 'trace', 'collector']),
  message: z.string().min(1),
  impact: z.enum(['diagnostic_only', 'not_gradable']),
}).strict();
export type ObservationIssue = z.infer<typeof ObservationIssueSchema>;

export const EvaluationMeasurementsSchema = z.object({
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  modelCalls: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  sourceCalls: z.number().int().nonnegative().default(0),
  retries: z.number().int().nonnegative().default(0),
  candidatesProduced: z.number().int().nonnegative().default(0),
  recommendationsPublished: z.number().int().nonnegative().default(0),
  preferenceRevisions: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
  graderModelCalls: z.number().int().nonnegative().default(0),
  graderInputTokens: z.number().int().nonnegative().default(0),
  graderOutputTokens: z.number().int().nonnegative().default(0),
  graderEstimatedCostUsd: z.number().nonnegative().default(0),
}).strict();
export type EvaluationMeasurements = z.infer<typeof EvaluationMeasurementsSchema>;

export const TaskObservationSchema = z.object({
  observationId: z.string().min(1),
  taskId: z.string().min(1),
  operation: EvaluationOperationSchema,
  profile: EvaluationProfileSchema,
  collectedAt: z.string().datetime({ offset: true }),
  environment: JsonRecordSchema,
  input: JsonRecordSchema,
  executionOutcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('completed') }).strict(),
    z.object({ status: z.literal('failed'), message: z.string().min(1) }).strict(),
    z.object({ status: z.literal('timed_out'), message: z.string().min(1) }).strict(),
  ]),
  productResult: JsonRecordSchema,
  artifacts: z.object({ workspaceFiles: z.record(z.string(), z.string()) }).strict(),
  correlations: z.array(z.record(z.string(), z.string())),
  traceIds: z.array(z.string().min(1)),
  traceSummaries: z.array(JsonRecordSchema),
  measurements: EvaluationMeasurementsSchema,
  issues: z.array(ObservationIssueSchema),
}).strict();
export type TaskObservation = z.infer<typeof TaskObservationSchema>;

/** Collects compact facts without duplicating Trace records or Content bodies. */
export async function observeTask(input: {
  readonly observationId: string;
  readonly task: EvaluationTask;
  readonly runtime: ProductRuntime;
  readonly execution: ProductTaskExecution;
  readonly workspacePath: string;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly startedAtMs: number;
  readonly collectedAt: string;
}): Promise<TaskObservation> {
  await input.runtime.host.observability.flush();
  const traces = await readCorrelatedTraces(input.runtime, input.task.input.type, input.execution.correlations);
  const spans = traces.flatMap((trace) => Array.isArray(trace.spans) ? trace.spans : []);
  const usage = collectModelUsage(traces);
  const productResult = toJsonRecord(input.execution.productResult);
  const observation = {
    observationId: input.observationId,
    taskId: input.task.taskId,
    operation: input.task.input.type,
    profile: input.environment.profile,
    collectedAt: input.collectedAt,
    environment: input.environment,
    input: toJsonRecord(input.task.input),
    executionOutcome: input.execution.outcome,
    productResult,
    artifacts: { workspaceFiles: await snapshotWorkspace(input.workspacePath) },
    correlations: input.execution.correlations,
    traceIds: traces.map(traceIdOf).filter((traceId): traceId is string => traceId !== undefined),
    traceSummaries: traces.map(summarizeTrace),
    measurements: {
      durationMs: Math.max(0, Date.now() - input.startedAtMs),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      modelCalls: countSpans(spans, (name) => name === 'model.call'),
      toolCalls: countSpans(spans, (name) => name === 'tool.call'),
      sourceCalls: countSpans(spans, (name) => name.startsWith('source.')),
      retries: countSpans(spans, (name) => name.includes('retry')),
      candidatesProduced: findNonnegativeInteger(productResult, ['availableAfter', 'candidateCount']),
      recommendationsPublished: countRecommendations(productResult),
      preferenceRevisions: countArraysAtKeys(productResult, ['resultRevisions', 'revisions']),
      estimatedCostUsd: usage.estimatedCostUsd,
      graderModelCalls: 0,
      graderInputTokens: 0,
      graderOutputTokens: 0,
      graderEstimatedCostUsd: 0,
    },
    issues: traceIssues(traces),
  };
  return TaskObservationSchema.parse(redactCredentials(observation));
}

/** Reads all UTF-8 files produced in the isolated Workspace. */
export async function snapshotWorkspace(workspaceRoot: string): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  await walk(workspaceRoot, workspaceRoot, files);
  return files;
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { value: parsed };
  return JsonRecordSchema.parse(parsed);
}

async function readCorrelatedTraces(
  runtime: ProductRuntime,
  operation: EvaluationTask['input']['type'],
  correlations: readonly Readonly<Record<string, string>>[],
): Promise<Readonly<Record<string, unknown>>[]> {
  const traces = new Map<string, Record<string, unknown>>();
  for (const correlation of correlations) {
    const listed = await runtime.host.observability.listTraces({ traceKind: operation, correlation, limit: 20 });
    if (listed.status !== 'ok') continue;
    for (const summary of listed.traces) {
      if (traces.has(summary.traceId)) continue;
      const result = await runtime.host.observability.getTrace({ traceId: summary.traceId });
      if (result.status !== 'found') continue;
      traces.set(summary.traceId, toJsonRecord(result.trace));
    }
  }
  return [...traces.values()];
}

function summarizeTrace(trace: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const summary = isRecord(trace.summary) ? trace.summary : {};
  const spans = Array.isArray(trace.spans) ? trace.spans.flatMap((span) => {
    if (!isRecord(span)) return [];
    return [{
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      status: span.status,
      durationMs: span.durationMs,
      metadata: compactMetadata(span.metadata),
    }];
  }) : [];
  return toJsonRecord({
    traceId: summary.traceId ?? trace.traceId,
    traceKind: summary.traceKind ?? trace.traceKind,
    status: summary.status ?? trace.status,
    diagnostics: summary.diagnostics ?? trace.diagnostics,
    startedAt: summary.startedAt ?? trace.startedAt,
    durationMs: summary.durationMs,
    issueCount: summary.issueCount ?? (Array.isArray(trace.issues) ? trace.issues.length : 0),
    spans,
  });
}

function compactMetadata(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => (
    key === 'toolName' || key === 'providerId' || key === 'modelId' || key === 'sourceId'
  )));
}

function traceIssues(traces: readonly Readonly<Record<string, unknown>>[]): ObservationIssue[] {
  if (traces.length === 0) {
    return [{
      code: 'correlated_trace_missing',
      source: 'trace',
      message: 'No correlated Trace was available.',
      impact: 'diagnostic_only',
    }];
  }
  return traces.some((trace) => {
    const summary = isRecord(trace.summary) ? trace.summary : trace;
    return summary.diagnostics === 'incomplete';
  })
    ? [{
        code: 'trace_incomplete',
        source: 'trace',
        message: 'A correlated Trace reports incomplete diagnostic capture.',
        impact: 'diagnostic_only',
      }]
    : [];
}

function traceIdOf(trace: Readonly<Record<string, unknown>>): string | undefined {
  const summary = isRecord(trace.summary) ? trace.summary : trace;
  return typeof summary.traceId === 'string' ? summary.traceId : undefined;
}

async function walk(root: string, directory: string, output: Record<string, string>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, output);
    else if (entry.isFile()) output[path.relative(root, absolute).replaceAll('\\', '/')] = await readFile(absolute, 'utf8');
  }
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /(?:api[_-]?key|authorization|cookie|password|secret|token)$/iu.test(key)
      ? '[REDACTED]'
      : redactCredentials(child),
  ]));
}

function countSpans(spans: readonly unknown[], matches: (name: string) => boolean): number {
  return spans.filter((span) => isRecord(span) && typeof span.name === 'string' && matches(span.name)).length;
}

function collectModelUsage(value: unknown): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
} {
  if (Array.isArray(value)) return value.map(collectModelUsage).reduce(addUsage, emptyUsage());
  if (!isRecord(value)) return emptyUsage();
  const own = readUsage(value.usage);
  return Object.entries(value)
    .filter(([key]) => key !== 'usage' && key !== 'records')
    .map(([, child]) => collectModelUsage(child))
    .reduce(addUsage, own);
}

function readUsage(value: unknown): ReturnType<typeof emptyUsage> {
  if (!isRecord(value)) return emptyUsage();
  const cost = isRecord(value.cost) ? value.cost.total : undefined;
  return {
    inputTokens: nonnegativeInteger(value.input),
    outputTokens: nonnegativeInteger(value.output),
    estimatedCostUsd: nonnegativeNumber(cost),
  };
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

function addUsage(left: ReturnType<typeof emptyUsage>, right: ReturnType<typeof emptyUsage>) {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    estimatedCostUsd: left.estimatedCostUsd + right.estimatedCostUsd,
  };
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function nonnegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function findNonnegativeInteger(value: unknown, keys: readonly string[]): number {
  if (Array.isArray(value)) return Math.max(0, ...value.map((child) => findNonnegativeInteger(child, keys)));
  if (!isRecord(value)) return 0;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0) return candidate;
  }
  return Math.max(0, ...Object.values(value).map((child) => findNonnegativeInteger(child, keys)));
}

function countRecommendations(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, child) => total + countRecommendations(child), 0);
  if (!isRecord(value)) return 0;
  const direct = Array.isArray(value.recommendations) ? value.recommendations.length : 0;
  return direct + Object.entries(value)
    .filter(([key]) => key !== 'recommendations')
    .reduce((total, [, child]) => total + countRecommendations(child), 0);
}

function countArraysAtKeys(value: unknown, keys: readonly string[]): number {
  if (Array.isArray(value)) return value.reduce((total, child) => total + countArraysAtKeys(child, keys), 0);
  if (!isRecord(value)) return 0;
  return Object.entries(value).reduce((total, [key, child]) => (
    total + (keys.includes(key) && Array.isArray(child) ? child.length : countArraysAtKeys(child, keys))
  ), 0);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
