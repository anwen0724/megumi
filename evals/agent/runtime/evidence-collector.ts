/* Collects product facts, correlated Traces, Runtime Events, and Measurements for one Task. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import type { AnyEvent } from '@megumi/events';
import { z } from 'zod';
import type { EvaluationRunConfig } from '../contracts/evaluation-run-config';
import {
  EvaluationProfileSchema,
  EvaluationRunnerSchema,
  type EvaluationTask,
} from '../contracts/evaluation-task';
import type { InstalledScenarioIds } from './scenario-installer';

export const EvidenceIssueSchema = z.object({
  code: z.string().min(1),
  source: z.enum(['business_fact', 'execution', 'trace', 'runtime_event', 'runtime_log', 'collector']),
  message: z.string().min(1),
  impact: z.enum(['diagnostic_only', 'not_gradable']),
}).strict();
export type EvidenceIssue = z.infer<typeof EvidenceIssueSchema>;

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

const JsonRecordSchema = z.record(z.string(), z.unknown());
export const EvidenceBundleSchema = z.object({
  evidenceId: z.string().min(1),
  taskId: z.string().min(1),
  runner: EvaluationRunnerSchema,
  profile: EvaluationProfileSchema,
  collectedAt: z.string().datetime({ offset: true }),
  environment: JsonRecordSchema,
  input: JsonRecordSchema,
  beforeFacts: JsonRecordSchema,
  completion: JsonRecordSchema,
  afterFacts: JsonRecordSchema,
  traces: z.array(JsonRecordSchema),
  runtimeEvents: z.array(JsonRecordSchema),
  measurements: EvaluationMeasurementsSchema,
  issues: z.array(EvidenceIssueSchema),
}).strict();
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type EvaluationMeasurements = z.infer<typeof EvaluationMeasurementsSchema>;

export interface TaskRunnerContext<TTask extends EvaluationTask = EvaluationTask> {
  readonly task: TTask;
  readonly runConfig: EvaluationRunConfig;
  readonly runtime: ProductRuntime;
  readonly scenarioIds: InstalledScenarioIds;
  readonly workspacePath: string;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly now: () => string;
}

export interface TaskExecutionEvidence {
  readonly input: Readonly<Record<string, unknown>>;
  readonly beforeFacts: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly afterFacts: Readonly<Record<string, unknown>>;
  readonly correlations: readonly Readonly<Record<string, string>>[];
  readonly runtimeEvents: readonly AnyEvent[];
}

export interface TaskRunner<TTask extends EvaluationTask = EvaluationTask> {
  readonly runner: TTask['runner'];
  execute(context: TaskRunnerContext<TTask>): Promise<TaskExecutionEvidence>;
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { value: parsed };
  return JsonRecordSchema.parse(parsed);
}

export async function waitForCommittedRun(input: {
  readonly runtime: ProductRuntime;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<Readonly<Record<string, unknown>>> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    const result = await input.runtime.host.session.readCommittedRun({
      sessionId: input.sessionId,
      executionId: input.executionId,
    });
    if (result.status === 'failed') return toJsonRecord(result);
    if (result.status === 'ok' && result.messages.some((entry) => (
      entry.type === 'message' && entry.message.kind === 'assistantReply'
    ))) {
      return toJsonRecord(result);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Conversation Execution did not settle before timeout: ${input.executionId}.`);
}

/** Reads the final isolated Workspace so file-producing Agent tasks can be graded. */
export async function snapshotWorkspace(workspaceRoot: string): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  await walk(workspaceRoot, workspaceRoot, files);
  return files;
}

/** Collects evidence in authority order and strips credential-shaped fields. */
export async function collectEvidence(input: {
  readonly evidenceId: string;
  readonly task: EvaluationTask;
  readonly runtime: ProductRuntime;
  readonly execution: TaskExecutionEvidence;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly startedAtMs: number;
  readonly collectedAt: string;
}): Promise<EvidenceBundle> {
  await input.runtime.host.observability.flush();
  const traces = await collectTraces(input.runtime, input.task.runner, input.execution.correlations);
  const issues = collectIssues(traces);
  const spans = traces.flatMap((trace) => Array.isArray(trace.spans) ? trace.spans : []);
  const modelUsage = collectModelUsage(traces);
  return EvidenceBundleSchema.parse(redactCredentials({
    evidenceId: input.evidenceId,
    taskId: input.task.taskId,
    runner: input.task.runner,
    profile: input.environment.profile,
    collectedAt: input.collectedAt,
    environment: input.environment,
    input: input.execution.input,
    beforeFacts: input.execution.beforeFacts,
    completion: input.execution.completion,
    afterFacts: input.execution.afterFacts,
    traces,
    runtimeEvents: input.execution.runtimeEvents,
    measurements: {
      durationMs: Math.max(0, Date.now() - input.startedAtMs),
      inputTokens: modelUsage.inputTokens,
      outputTokens: modelUsage.outputTokens,
      modelCalls: countSpans(spans, (name) => name === 'model.call'),
      toolCalls: countSpans(spans, (name) => name === 'tool.call'),
      sourceCalls: countSpans(spans, (name) => name.startsWith('source.')),
      retries: countSpans(spans, (name) => name.includes('retry')),
      candidatesProduced: numberAt(input.execution.completion, 'availableAfter'),
      recommendationsPublished: recommendationCount(input.execution.afterFacts),
      preferenceRevisions: countPreferenceRevisions(input.execution.completion),
      estimatedCostUsd: modelUsage.estimatedCostUsd,
    },
    issues,
  }));
}

function collectIssues(traces: readonly Readonly<Record<string, unknown>>[]): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  if (traces.length === 0) {
    issues.push({
      code: 'correlated_trace_missing',
      source: 'trace',
      message: 'No correlated Trace was available.',
      impact: 'diagnostic_only',
    });
  }
  if (traces.some((trace) => {
    const summary = trace.summary;
    return typeof summary === 'object' && summary !== null
      && 'diagnostics' in summary && summary.diagnostics === 'incomplete';
  })) {
    issues.push({
      code: 'trace_incomplete',
      source: 'trace',
      message: 'A correlated Trace reports incomplete diagnostic capture.',
      impact: 'diagnostic_only',
    });
  }
  return issues;
}

async function collectTraces(
  runtime: ProductRuntime,
  runner: EvaluationTask['runner'],
  correlations: readonly Readonly<Record<string, string>>[],
): Promise<Readonly<Record<string, unknown>>[]> {
  const traces = new Map<string, Record<string, unknown>>();
  for (const correlation of correlations) {
    const listed = await runtime.host.observability.listTraces({ traceKind: runner, correlation, limit: 20 });
    if (listed.status !== 'ok') continue;
    for (const summary of listed.traces) {
      if (traces.has(summary.traceId)) continue;
      const result = await runtime.host.observability.getTrace({ traceId: summary.traceId });
      if (result.status !== 'found') continue;
      const contentBodies: Record<string, unknown> = {};
      for (const checkpoint of result.trace.contents) {
        const content = await runtime.host.observability.getContent({
          traceId: summary.traceId,
          sequence: checkpoint.sequence,
        });
        contentBodies[String(checkpoint.sequence)] = decodeTraceContent(content);
      }
      traces.set(summary.traceId, { ...result.trace, contentBodies });
    }
  }
  return [...traces.values()];
}

function decodeTraceContent(
  result: Awaited<ReturnType<ProductRuntime['host']['observability']['getContent']>>,
): unknown {
  if (result.status !== 'available') return result;
  if (result.content.encoding === 'json') {
    try {
      return JSON.parse(result.content.json);
    } catch {
      return result;
    }
  }
  return result.content.encoding === 'text' ? result.content.text : result.content;
}

async function walk(root: string, directory: string, output: Record<string, string>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, output);
    } else if (entry.isFile()) {
      output[path.relative(root, absolute).replaceAll('\\', '/')] = await readFile(absolute, 'utf8');
    }
  }
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (typeof value !== 'object' || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = /(?:api[_-]?key|authorization|cookie|password|secret|token)$/iu.test(key)
      ? '[REDACTED]'
      : redactCredentials(child);
  }
  return output;
}

function countSpans(spans: unknown[], matches: (name: string) => boolean): number {
  return spans.filter((span) => {
    if (typeof span !== 'object' || span === null || !('name' in span)) return false;
    return typeof span.name === 'string' && matches(span.name);
  }).length;
}

function collectModelUsage(value: unknown): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
} {
  if (Array.isArray(value)) return value.map(collectModelUsage).reduce(addModelUsage, emptyModelUsage());
  if (typeof value !== 'object' || value === null) return emptyModelUsage();
  const record = JsonRecordSchema.parse(value);
  const ownUsage = readUsage(record.usage);
  return Object.entries(record)
    .filter(([key]) => key !== 'usage')
    .map(([, child]) => collectModelUsage(child))
    .reduce(addModelUsage, ownUsage);
}

function readUsage(value: unknown): ReturnType<typeof emptyModelUsage> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyModelUsage();
  const usage = JsonRecordSchema.parse(value);
  const costResult = JsonRecordSchema.safeParse(usage.cost);
  const cost = costResult.success ? costResult.data.total : undefined;
  return {
    inputTokens: nonnegativeInteger(usage.input),
    outputTokens: nonnegativeInteger(usage.output),
    estimatedCostUsd: nonnegativeNumber(cost),
  };
}

function emptyModelUsage() {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

function addModelUsage(
  left: ReturnType<typeof emptyModelUsage>,
  right: ReturnType<typeof emptyModelUsage>,
): ReturnType<typeof emptyModelUsage> {
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

function numberAt(value: Readonly<Record<string, unknown>>, key: string): number {
  const direct = value[key];
  return typeof direct === 'number' && direct >= 0 ? direct : 0;
}

function recommendationCount(value: Readonly<Record<string, unknown>>): number {
  const days = value.days;
  if (!Array.isArray(days)) return 0;
  return days.reduce((count, day) => {
    if (typeof day !== 'object' || day === null || !('recommendations' in day) || !Array.isArray(day.recommendations)) {
      return count;
    }
    return count + day.recommendations.length;
  }, 0);
}

function countPreferenceRevisions(value: Readonly<Record<string, unknown>>): number {
  const revisions = value.resultRevisions ?? value.revisions;
  return Array.isArray(revisions) ? revisions.length : 0;
}
