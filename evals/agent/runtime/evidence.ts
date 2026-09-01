/* Defines collected execution evidence and collection integrity issues. */
import type { ProductRuntime } from '@megumi/composition';
import type { AnyEvent } from '@megumi/events';
import { z } from 'zod';
import {
  EvaluationCapabilitySchema,
  EvaluationProfileSchema,
  type EvaluationCase,
} from '../catalog/evaluation-case';
import type { EvaluationRunConfig } from '../catalog/evaluation-run-config';
import type { InstalledFixtureIds } from '../fixtures/install-fixture';

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
  caseId: z.string().min(1),
  capability: EvaluationCapabilitySchema,
  profile: EvaluationProfileSchema,
  collectedAt: z.string().datetime({ offset: true }),
  environment: JsonRecordSchema,
  input: JsonRecordSchema,
  beforeFacts: JsonRecordSchema,
  completion: JsonRecordSchema,
  afterFacts: JsonRecordSchema,
  trace: JsonRecordSchema.nullable(),
  runtimeEvents: z.array(JsonRecordSchema),
  measurements: EvaluationMeasurementsSchema,
  issues: z.array(EvidenceIssueSchema),
}).strict();
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type EvaluationMeasurements = z.infer<typeof EvaluationMeasurementsSchema>;

export interface CapabilityEvaluationContext<TCase extends EvaluationCase = EvaluationCase> {
  readonly evaluationCase: TCase;
  readonly runConfig: EvaluationRunConfig;
  readonly runtime: ProductRuntime;
  readonly fixtureIds: InstalledFixtureIds;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly now: () => string;
}

export interface CapabilityExecutionEvidence {
  readonly input: Readonly<Record<string, unknown>>;
  readonly beforeFacts: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly afterFacts: Readonly<Record<string, unknown>>;
  readonly correlation: Readonly<Record<string, string>>;
  readonly runtimeEvents: readonly AnyEvent[];
}

export interface CapabilityEvaluation<TCase extends EvaluationCase = EvaluationCase> {
  readonly capability: TCase['capability'];
  execute(context: CapabilityEvaluationContext<TCase>): Promise<CapabilityExecutionEvidence>;
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

/** Collects one capability's evidence in authority order and removes credential fields. */
export async function collectEvidence(input: {
  readonly evidenceId: string;
  readonly evaluationCase: EvaluationCase;
  readonly runtime: ProductRuntime;
  readonly execution: CapabilityExecutionEvidence;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly startedAtMs: number;
  readonly collectedAt: string;
}): Promise<EvidenceBundle> {
  await input.runtime.host.observability.flush();
  const trace = await collectTrace(input.runtime, input.evaluationCase.capability, input.execution.correlation);
  const issues: EvidenceIssue[] = [];
  addMissingRecordIssue(issues, input.evaluationCase, 'input', input.execution.input, 'execution');
  addMissingRecordIssue(issues, input.evaluationCase, 'before_facts', input.execution.beforeFacts, 'business_fact');
  addMissingRecordIssue(issues, input.evaluationCase, 'completion', input.execution.completion, 'business_fact');
  addMissingRecordIssue(issues, input.evaluationCase, 'after_facts', input.execution.afterFacts, 'business_fact');
  if (input.evaluationCase.requiredEvidence.includes('trace') && !trace) {
    issues.push({
      code: 'required_trace_missing',
      source: 'trace',
      message: 'No correlated Trace was available.',
      impact: 'not_gradable',
    });
  }
  if (input.evaluationCase.requiredEvidence.includes('runtime_events') && input.execution.runtimeEvents.length === 0) {
    issues.push({
      code: 'required_runtime_events_missing',
      source: 'runtime_event',
      message: 'No correlated Runtime Event was retained.',
      impact: 'not_gradable',
    });
  }
  if (trace?.summary && typeof trace.summary === 'object' && 'diagnostics' in trace.summary
    && trace.summary.diagnostics === 'incomplete') {
    issues.push({
      code: 'trace_incomplete',
      source: 'trace',
      message: 'The correlated Trace reports incomplete diagnostic capture.',
      impact: 'diagnostic_only',
    });
  }
  const spans = trace && Array.isArray(trace.spans) ? trace.spans : [];
  const modelUsage = collectModelUsage(trace);
  return EvidenceBundleSchema.parse(redactCredentials({
    evidenceId: input.evidenceId,
    caseId: input.evaluationCase.caseId,
    capability: input.evaluationCase.capability,
    profile: input.environment.profile,
    collectedAt: input.collectedAt,
    environment: input.environment,
    input: input.execution.input,
    beforeFacts: input.execution.beforeFacts,
    completion: input.execution.completion,
    afterFacts: input.execution.afterFacts,
    trace,
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

function addMissingRecordIssue(
  issues: EvidenceIssue[],
  evaluationCase: EvaluationCase,
  requirement: 'input' | 'before_facts' | 'completion' | 'after_facts',
  value: Readonly<Record<string, unknown>>,
  source: 'business_fact' | 'execution',
): void {
  if (!evaluationCase.requiredEvidence.includes(requirement) || Object.keys(value).length > 0) return;
  issues.push({
    code: `required_${requirement}_missing`,
    source,
    message: `Required ${requirement.replaceAll('_', ' ')} Evidence was empty.`,
    impact: 'not_gradable',
  });
}

async function collectTrace(
  runtime: ProductRuntime,
  capability: EvaluationCase['capability'],
  correlation: Readonly<Record<string, string>>,
): Promise<Record<string, unknown> | null> {
  const listed = await runtime.host.observability.listTraces({ traceKind: capability, correlation, limit: 20 });
  if (listed.status !== 'ok' || listed.traces.length === 0) return null;
  const summary = listed.traces[0];
  const result = await runtime.host.observability.getTrace({ traceId: summary.traceId });
  if (result.status !== 'found') return null;
  const contentBodies: Record<string, unknown> = {};
  for (const checkpoint of result.trace.contents) {
    const content = await runtime.host.observability.getContent({
      traceId: summary.traceId,
      sequence: checkpoint.sequence,
    });
    contentBodies[String(checkpoint.sequence)] = decodeTraceContent(content);
  }
  return { ...result.trace, contentBodies };
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
