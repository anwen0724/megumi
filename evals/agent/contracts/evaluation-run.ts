/*
 * Defines Evaluation Run inputs and immutable execution records without any grading concepts.
 */
import { z } from 'zod';
import {
  EvaluationCaseSchema,
  EvaluationEnvironmentKindSchema,
  StableEvaluationIdSchema,
} from './evaluation-dataset';

const EvaluationIdentitySchema = z.string().regex(
  /^(?:controlled|live)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u,
);
const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const ProviderApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'google-generative-ai',
]);

export const CandidateModelConfigSchema = z.object({
  source: z.literal('explicit'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  api: ProviderApiSchema,
  baseUrl: z.string().url(),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  credentialEnvironmentVariable: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u),
}).strict();
export type CandidateModelConfig = z.infer<typeof CandidateModelConfigSchema>;

export const EvaluationRunRequestSchema = z.object({
  datasetIds: z.array(EvaluationIdentitySchema).default([]),
  caseIds: z.array(EvaluationIdentitySchema).default([]),
  candidateModel: CandidateModelConfigSchema,
  safetyWallClockLimitMs: z.number().int().positive().default(900_000),
}).strict().superRefine((request, context) => {
  if (request.datasetIds.length === 0 && request.caseIds.length === 0) {
    context.addIssue({
      code: 'custom', path: ['datasetIds'],
      message: 'Evaluation Run requires at least one Dataset or Case.',
    });
  }
});
export type EvaluationRunRequest = z.infer<typeof EvaluationRunRequestSchema>;

export const CandidateModelRecordSchema = z.object({
  source: z.literal('explicit'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  api: z.string().min(1),
  baseUrl: z.string().url(),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
}).strict();
export type CandidateModelRecord = z.infer<typeof CandidateModelRecordSchema>;

const DatasetRecordSchema = z.object({
  identity: EvaluationIdentitySchema,
  revision: z.number().int().positive(),
  digest: Sha256Schema,
}).strict();

export const CaseSnapshotSchema = z.object({
  identity: EvaluationIdentitySchema,
  environmentKind: EvaluationEnvironmentKindSchema,
  revision: z.number().int().positive(),
  digest: Sha256Schema,
  resources: z.record(z.string(), Sha256Schema),
  datasetMemberships: z.array(EvaluationIdentitySchema),
  case: EvaluationCaseSchema,
}).strict();
export type CaseSnapshot = z.infer<typeof CaseSnapshotSchema>;

const TraceTargetResultSchema = z.object({
  traceKind: z.enum([
    'conversation', 'interest_understanding', 'candidate_supply',
    'recommendation', 'preference_learning',
  ]),
  correlation: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  matchedTraceIds: z.array(z.string().min(1)),
}).strict();

export const CaseRunResultSchema = z.object({
  schemaVersion: z.literal(2),
  caseRunId: StableEvaluationIdSchema,
  caseIdentity: EvaluationIdentitySchema,
  caseType: z.enum([
    'conversation', 'interest_understanding', 'candidate_supply',
    'recommendation', 'preference_learning',
  ]),
  recordStatus: z.enum(['recorded', 'infrastructure_failed']),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  terminalState: z.enum(['settled', 'pending', 'interrupted']).optional(),
  candidateModel: CandidateModelRecordSchema,
  environment: z.record(z.string(), JsonValueSchema),
  businessIds: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  productResult: JsonValueSchema.optional(),
  ownerFacts: JsonValueSchema.optional(),
  finalState: z.discriminatedUnion('status', [
    z.object({ status: z.literal('captured'), facts: JsonValueSchema }).strict(),
    z.object({ status: z.literal('unavailable'), message: z.string() }).strict(),
  ]),
  interruption: z.object({ source: z.literal('evaluation_safety_guard'), limitMs: z.number().positive() }).strict().optional(),
  issues: z.array(z.object({ phase: z.enum(['execution', 'shutdown', 'business_facts', 'trace', 'archive']), message: z.string() }).strict()).default([]),
  traceIntegrity: z.object({
    status: z.enum(['complete', 'incomplete']),
    traceCount: z.number().int().nonnegative(),
    health: JsonValueSchema,
    targets: z.array(TraceTargetResultSchema),
    issues: z.array(z.string()),
  }).strict(),
  artifacts: z.object({
    files: z.array(z.object({
      path: z.string().min(1), sha256: Sha256Schema, byteLength: z.number().int().nonnegative(),
    }).strict()),
    deletedFiles: z.array(z.string()).default([]),
    initialFiles: z.array(z.object({ path: z.string(), sha256: Sha256Schema, byteLength: z.number().int().nonnegative() }).strict()).default([]),
  }).strict(),
  error: z.object({ name: z.string().min(1), message: z.string() }).strict().optional(),
}).strict();
export type CaseRunResult = z.infer<typeof CaseRunResultSchema>;

export const EvaluationRunRecordSchema = z.object({
  schemaVersion: z.literal(2),
  runId: StableEvaluationIdSchema,
  status: z.enum(['completed', 'completed_with_failures']),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  selection: z.object({
    datasets: z.array(DatasetRecordSchema),
    directCaseIds: z.array(EvaluationIdentitySchema),
  }).strict(),
  candidateModel: CandidateModelRecordSchema,
  runtime: z.object({
    productVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    safetyWallClockLimitMs: z.number().int().positive(),
  }).strict(),
  caseRuns: z.array(z.object({
    caseRunId: StableEvaluationIdSchema,
    caseIdentity: EvaluationIdentitySchema,
    datasetMemberships: z.array(EvaluationIdentitySchema),
    recordStatus: z.enum(['recorded', 'infrastructure_failed']),
    resultPath: z.string().min(1),
  }).strict()),
}).strict();
export type EvaluationRunRecord = z.infer<typeof EvaluationRunRecordSchema>;
