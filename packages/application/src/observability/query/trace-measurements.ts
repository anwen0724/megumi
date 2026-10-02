/*
 * Derives evaluation-ready measurements from projected Trace facts and captured model responses.
 */
import { z } from 'zod';
import type { ContentStoreReadResult } from '../content/content-store';
import type { DiagnosticJsonValue } from '../diagnostic-value';
import type { TraceProjection } from './trace-projector';

const ModelUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.object({
    total: z.number().nonnegative(),
  }).passthrough(),
}).passthrough();

export type TraceMeasurementIssueCode =
  | 'trace_incomplete'
  | 'model_usage_missing'
  | 'model_usage_unavailable';

export interface TraceMeasurementIssue {
  readonly code: TraceMeasurementIssueCode;
  readonly sequence?: number;
}

export interface TraceTokenUsageMeasurements {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}

export interface TraceMeasurements {
  readonly traceId: string;
  readonly diagnostics: 'complete' | 'incomplete';
  readonly durationMs?: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly sourceCalls: number;
  readonly retries: number;
  readonly usage: TraceTokenUsageMeasurements;
  readonly issues: readonly TraceMeasurementIssue[];
}

export interface DeriveTraceMeasurementsOptions {
  readonly trace: TraceProjection;
  readContent(contentId: string): Promise<ContentStoreReadResult>;
}

/** Derives measurements without writing a second copy of any Journal fact. */
export async function deriveTraceMeasurements(
  options: DeriveTraceMeasurementsOptions,
): Promise<TraceMeasurements> {
  const trace = options.trace;
  const modelCalls = countSpans(trace, 'model.call');
  const issues: TraceMeasurementIssue[] = trace.diagnostics === 'incomplete'
    ? [{ code: 'trace_incomplete' }]
    : [];
  const usages: z.infer<typeof ModelUsageSchema>[] = [];
  for (const checkpoint of trace.contents) {
    if (checkpoint.kind !== 'model.response') continue;
    const value = await readCapturedValue(checkpoint.content, options.readContent);
    if (value.status === 'unavailable') {
      issues.push({ code: 'model_usage_unavailable', sequence: checkpoint.sequence });
      continue;
    }
    const usage = readModelUsage(value.value);
    if (usage) usages.push(usage);
    else issues.push({ code: 'model_usage_missing', sequence: checkpoint.sequence });
  }
  if (modelCalls > usages.length && !issues.some(isModelUsageIssue)) {
    issues.push({ code: 'model_usage_missing' });
  }

  return {
    traceId: trace.traceId,
    diagnostics: issues.length === 0 ? 'complete' : 'incomplete',
    ...durationBetween(trace.startedAt, trace.endedAt),
    modelCalls,
    toolCalls: countSpans(trace, 'tool.call'),
    sourceCalls: trace.spans.filter(({ name }) => name === 'source.search' || name === 'source.read').length,
    retries: trace.spans.reduce((total, span) => (
      total + span.events.filter(({ event }) => event.type.endsWith('.retry.scheduled')).length
    ), 0),
    usage: usages.reduce(addUsage, emptyUsage()),
    issues,
  };
}

function countSpans(trace: TraceProjection, name: TraceProjection['spans'][number]['name']): number {
  return trace.spans.filter((span) => span.name === name).length;
}

function readModelUsage(value: DiagnosticJsonValue): z.infer<typeof ModelUsageSchema> | undefined {
  if (!isRecord(value)) return undefined;
  const parsed = ModelUsageSchema.safeParse(value.usage);
  return parsed.success ? parsed.data : undefined;
}

async function readCapturedValue(
  content: TraceProjection['contents'][number]['content'],
  readContent: DeriveTraceMeasurementsOptions['readContent'],
): Promise<{ readonly status: 'available'; readonly value: DiagnosticJsonValue } | { readonly status: 'unavailable' }> {
  if (content.mode === 'inline') return { status: 'available', value: content.value };
  if (content.mode !== 'stored') return { status: 'unavailable' };
  const stored = await readContent(content.contentId);
  if (stored.status !== 'available') return { status: 'unavailable' };
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.bytes));
    return isDiagnosticJsonValue(value)
      ? { status: 'available', value }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

function addUsage(
  total: TraceTokenUsageMeasurements,
  usage: z.infer<typeof ModelUsageSchema>,
): TraceTokenUsageMeasurements {
  return {
    inputTokens: total.inputTokens + usage.input,
    outputTokens: total.outputTokens + usage.output,
    cacheReadTokens: total.cacheReadTokens + usage.cacheRead,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWrite,
    reasoningTokens: total.reasoningTokens + (usage.reasoning ?? 0),
    totalTokens: total.totalTokens + usage.totalTokens,
    estimatedCostUsd: total.estimatedCostUsd + usage.cost.total,
  };
}

function emptyUsage(): TraceTokenUsageMeasurements {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

function durationBetween(
  startedAt: string | undefined,
  endedAt: string | undefined,
): { readonly durationMs?: number } {
  if (!startedAt || !endedAt) return {};
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(durationMs) ? { durationMs: Math.max(0, durationMs) } : {};
}

function isModelUsageIssue(issue: TraceMeasurementIssue): boolean {
  return issue.code === 'model_usage_missing' || issue.code === 'model_usage_unavailable';
}

function isRecord(value: DiagnosticJsonValue): value is { readonly [key: string]: DiagnosticJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiagnosticJsonValue(value: unknown): value is DiagnosticJsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isDiagnosticJsonValue);
  return typeof value === 'object'
    && Object.values(value).every(isDiagnosticJsonValue);
}
