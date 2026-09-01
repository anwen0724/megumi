/*
 * Projects one real product execution into compact product facts, typed Trace
 * references, and structured Evidence for deterministic and model Graders.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import { z } from 'zod';
import { EvaluationMeasurementNameSchema } from '../contracts/evaluation-metric';
import { EvaluationOperationSchema, EvaluationProfileSchema, type EvaluationTask } from '../contracts/evaluation-task';
import type { ProductTaskExecution } from './execute-task';
import {
  TraceEvidenceContentSchema,
  TraceTargetSchema,
  collectTraceEvidence,
} from './trace-evidence';

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
  unavailable: z.array(EvaluationMeasurementNameSchema).default([]),
}).strict();
export type EvaluationMeasurements = z.infer<typeof EvaluationMeasurementsSchema>;

const TraceContentSectionSchema = z.object({
  business: JsonRecordSchema,
  traceContent: z.array(TraceEvidenceContentSchema),
}).strict();

export const EvaluationEvidenceSchema = z.object({
  input: TraceContentSectionSchema.extend({ task: JsonRecordSchema }).strict(),
  context: TraceContentSectionSchema,
  execution: TraceContentSectionSchema.extend({
    outcome: z.discriminatedUnion('status', [
      z.object({ status: z.literal('completed') }).strict(),
      z.object({ status: z.literal('failed'), message: z.string().min(1) }).strict(),
      z.object({ status: z.literal('timed_out'), message: z.string().min(1) }).strict(),
    ]),
    traces: z.array(JsonRecordSchema),
  }).strict(),
  output: TraceContentSectionSchema.extend({
    productResult: JsonRecordSchema,
    workspaceFiles: z.record(z.string(), z.string()),
  }).strict(),
  measurement: EvaluationMeasurementsSchema,
}).strict();
export type EvaluationEvidence = z.infer<typeof EvaluationEvidenceSchema>;

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
  traceTargets: z.array(TraceTargetSchema),
  traceIds: z.array(z.string().min(1)),
  traceSummaries: z.array(JsonRecordSchema),
  evidence: EvaluationEvidenceSchema,
  measurements: EvaluationMeasurementsSchema,
  issues: z.array(ObservationIssueSchema),
}).strict();
export type TaskObservation = z.infer<typeof TaskObservationSchema>;

/** Collects product facts and only the native Trace Evidence exposed by Product Host. */
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
  const [traceEvidence, workspaceFiles] = await Promise.all([
    collectTraceEvidence({ runtime: input.runtime, targets: input.execution.traceTargets }),
    snapshotWorkspace(input.workspacePath),
  ]);
  const productResult = toJsonRecord(input.execution.productResult);
  const businessMeasurements = input.execution.businessMeasurements ?? {};
  const unavailable = new Set(traceEvidence.measurements.unavailable);
  addUnavailableBusinessMeasurements(input.task.input.type, businessMeasurements, unavailable);
  const measurements: EvaluationMeasurements = {
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    inputTokens: traceEvidence.measurements.inputTokens,
    outputTokens: traceEvidence.measurements.outputTokens,
    modelCalls: traceEvidence.measurements.modelCalls,
    toolCalls: traceEvidence.measurements.toolCalls,
    sourceCalls: traceEvidence.measurements.sourceCalls,
    retries: traceEvidence.measurements.retries,
    candidatesProduced: businessMeasurements.candidatesProduced ?? 0,
    recommendationsPublished: businessMeasurements.recommendationsPublished ?? 0,
    preferenceRevisions: businessMeasurements.preferenceRevisions ?? 0,
    estimatedCostUsd: traceEvidence.measurements.estimatedCostUsd,
    graderModelCalls: 0,
    graderInputTokens: 0,
    graderOutputTokens: 0,
    graderEstimatedCostUsd: 0,
    unavailable: [...unavailable],
  };
  const businessEvidence = input.execution.evidence ?? {};
  const evidence: EvaluationEvidence = {
    input: {
      task: toJsonRecord(input.task.input),
      business: toJsonRecord(businessEvidence.input ?? {}),
      traceContent: traceEvidence.content.input,
    },
    context: {
      business: toJsonRecord(businessEvidence.context ?? {}),
      traceContent: traceEvidence.content.context,
    },
    execution: {
      outcome: input.execution.outcome,
      traces: [...traceEvidence.traceSummaries],
      business: {},
      traceContent: traceEvidence.content.execution,
    },
    output: {
      productResult,
      workspaceFiles,
      business: toJsonRecord(businessEvidence.output ?? {}),
      traceContent: traceEvidence.content.output,
    },
    measurement: measurements,
  };
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
    artifacts: { workspaceFiles },
    traceTargets: input.execution.traceTargets,
    traceIds: traceEvidence.traceIds,
    traceSummaries: traceEvidence.traceSummaries,
    evidence,
    measurements,
    issues: traceEvidence.issues,
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

function addUnavailableBusinessMeasurements(
  operation: EvaluationTask['input']['type'],
  measurements: ProductTaskExecution['businessMeasurements'],
  unavailable: Set<z.infer<typeof EvaluationMeasurementNameSchema>>,
): void {
  if (operation === 'candidate_supply' && measurements?.candidatesProduced === undefined) {
    unavailable.add('candidatesProduced');
  }
  if (operation === 'daily_recommendation' && measurements?.recommendationsPublished === undefined) {
    unavailable.add('recommendationsPublished');
  }
  if (operation === 'preference_learning' && measurements?.preferenceRevisions === undefined) {
    unavailable.add('preferenceRevisions');
  }
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
