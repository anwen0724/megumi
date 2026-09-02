/*
 * Defines the author-facing Evaluation Task: initial state, real product input, and Metrics.
 */
import { z } from 'zod';
import { EvaluationMetricSchema, StableEvaluationIdSchema } from './evaluation-metric';

export const EvaluationOperationSchema = z.enum([
  'conversation',
  'interest_understanding',
  'candidate_supply',
  'daily_recommendation',
  'preference_learning',
]);
export type EvaluationOperation = z.infer<typeof EvaluationOperationSchema>;

export const EvaluationProfileSchema = z.enum(['controlled', 'live']);
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

const StableReferenceIdSchema = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/);
const WorkspaceFileSchema = z.object({
  path: z.string().min(1).refine(isSafeRelativePath, 'Workspace file path must stay inside the Task Workspace.'),
  content: z.string(),
}).strict();
const SessionInitialStateSchema = z.object({
  referenceId: StableReferenceIdSchema,
  title: z.string().min(1),
  turns: z.array(z.object({ user: z.string(), assistant: z.string() }).strict()).default([]),
}).strict();
const InterestInitialStateSchema = z.object({
  referenceId: StableReferenceIdSchema,
  description: z.string().min(1).max(1_000),
  status: z.enum(['active', 'paused']).default('active'),
}).strict();
const CandidateInitialStateSchema = z.object({
  referenceId: StableReferenceIdSchema,
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  contentText: z.string().optional(),
  matchedInterestReferenceIds: z.array(StableReferenceIdSchema),
  relevance: z.enum(['direct', 'adjacent', 'exploration']),
}).strict();
const RecommendationInitialStateSchema = z.object({
  referenceId: StableReferenceIdSchema,
  candidateReferenceId: StableReferenceIdSchema,
  reason: z.string().min(1),
  reaction: z.enum(['liked', 'disliked', 'none']).default('none'),
}).strict();
const PreferenceInitialStateSchema = z.object({
  scopeKey: z.string().min(1),
  directionId: z.string().min(1),
  polarity: z.enum(['positive', 'negative']),
  dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality']),
  statement: z.string().min(1),
  supportingRecommendationReferenceIds: z.array(StableReferenceIdSchema).min(1),
}).strict();
const ControlledSearchSchema = z.object({
  sourceId: z.string().min(1),
  queryIncludes: z.string(),
  results: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    snippet: z.string().optional(),
    content: z.string().optional(),
  }).strict()),
}).strict();

export const EvaluationInitialStateSchema = z.object({
  clock: z.string().datetime({ offset: true }),
  dailyTargetCount: z.number().int().min(1).max(100).default(3),
  workspaceFiles: z.array(WorkspaceFileSchema).default([]),
  sessions: z.array(SessionInitialStateSchema).default([]),
  interests: z.array(InterestInitialStateSchema).default([]),
  candidates: z.array(CandidateInitialStateSchema).default([]),
  recommendations: z.array(RecommendationInitialStateSchema).default([]),
  preferences: z.array(PreferenceInitialStateSchema).default([]),
  controlledSearch: z.array(ControlledSearchSchema).default([]),
  permissionDecision: z.enum(['allow', 'deny', 'ask']).default('allow'),
}).strict();
export type EvaluationInitialState = z.infer<typeof EvaluationInitialStateSchema>;

const ConversationInputSchema = z.object({
  type: z.literal('conversation'),
  steps: z.array(z.object({
    userInput: z.string().min(1),
    permissionMode: z.enum(['ask', 'auto', 'full_access']).default('auto'),
  }).strict()).min(1),
}).strict();
const InterestUnderstandingInputSchema = z.object({
  type: z.literal('interest_understanding'),
  text: z.string().min(1),
}).strict();
const CandidateSupplyInputSchema = z.object({ type: z.literal('candidate_supply') }).strict();
const DailyRecommendationInputSchema = z.object({ type: z.literal('daily_recommendation') }).strict();
const PreferenceLearningInputSchema = z.object({
  type: z.literal('preference_learning'),
  recommendationReferenceId: StableReferenceIdSchema,
  reaction: z.enum(['liked', 'disliked', 'none']),
}).strict();

export const EvaluationTaskInputSchema = z.discriminatedUnion('type', [
  ConversationInputSchema,
  InterestUnderstandingInputSchema,
  CandidateSupplyInputSchema,
  DailyRecommendationInputSchema,
  PreferenceLearningInputSchema,
]);
export type EvaluationTaskInput = z.infer<typeof EvaluationTaskInputSchema>;

export const EvaluationTaskSchema = z.object({
  taskId: StableEvaluationIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  difficulty: z.enum(['simple', 'medium', 'complex']),
  profiles: z.array(EvaluationProfileSchema).min(1),
  tags: z.array(StableEvaluationIdSchema).default([]),
  initialState: EvaluationInitialStateSchema,
  input: EvaluationTaskInputSchema,
  metrics: z.array(EvaluationMetricSchema).min(1),
}).strict().superRefine((task, context) => {
  uniqueValues(task.metrics.map((metric) => metric.metricId), ['metrics'], 'Metric ID', context);
  uniqueValues(task.initialState.workspaceFiles.map((entry) => entry.path), ['initialState', 'workspaceFiles'], 'Workspace file path', context);
  uniqueValues(task.initialState.sessions.map((entry) => entry.referenceId), ['initialState', 'sessions'], 'Session reference', context);
  const interestIds = uniqueValues(task.initialState.interests.map((entry) => entry.referenceId), ['initialState', 'interests'], 'Interest reference', context);
  const candidateIds = uniqueValues(task.initialState.candidates.map((entry) => entry.referenceId), ['initialState', 'candidates'], 'Candidate reference', context);
  const recommendationIds = uniqueValues(task.initialState.recommendations.map((entry) => entry.referenceId), ['initialState', 'recommendations'], 'Recommendation reference', context);
  for (const [candidateIndex, candidate] of task.initialState.candidates.entries()) {
    for (const [referenceIndex, interestId] of candidate.matchedInterestReferenceIds.entries()) {
      addMissingReference(interestIds, interestId, ['initialState', 'candidates', candidateIndex, 'matchedInterestReferenceIds', referenceIndex], 'Interest', context);
    }
  }
  for (const [index, recommendation] of task.initialState.recommendations.entries()) {
    addMissingReference(candidateIds, recommendation.candidateReferenceId, ['initialState', 'recommendations', index, 'candidateReferenceId'], 'Candidate', context);
  }
  for (const [preferenceIndex, preference] of task.initialState.preferences.entries()) {
    for (const [referenceIndex, recommendationId] of preference.supportingRecommendationReferenceIds.entries()) {
      addMissingReference(recommendationIds, recommendationId, ['initialState', 'preferences', preferenceIndex, 'supportingRecommendationReferenceIds', referenceIndex], 'Recommendation', context);
    }
  }
  if (task.input.type === 'preference_learning') {
    addMissingReference(recommendationIds, task.input.recommendationReferenceId, ['input', 'recommendationReferenceId'], 'Recommendation', context);
  }
});

export type EvaluationTask = z.infer<typeof EvaluationTaskSchema>;

/** Maps a product operation to the directory containing its Evaluation Tasks. */
export function evaluationTaskDirectory(operation: EvaluationOperation): string {
  return operation.replaceAll('_', '-');
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/')
    && !/^[a-z]:\//iu.test(normalized)
    && normalized.split('/').every((part) => part !== '' && part !== '..');
}

function uniqueValues(
  values: readonly string[],
  path: readonly (string | number)[],
  label: string,
  context: z.RefinementCtx,
): ReadonlySet<string> {
  const unique = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (unique.has(value)) {
      context.addIssue({ code: 'custom', path: [...path, index], message: `${label} is duplicated: ${value}.` });
    }
    unique.add(value);
  }
  return unique;
}

function addMissingReference(
  values: ReadonlySet<string>,
  reference: string,
  path: readonly (string | number)[],
  label: string,
  context: z.RefinementCtx,
): void {
  if (values.has(reference)) return;
  context.addIssue({ code: 'custom', path: [...path], message: `${label} initial-state reference does not exist: ${reference}.` });
}
