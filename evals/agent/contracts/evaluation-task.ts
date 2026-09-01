/*
 * Defines the single-file Evaluation Task contract: scenario, product input, and Metrics.
 */
import { z } from 'zod';
import { EvaluationMetricSchema, StableEvaluationIdSchema } from './evaluation-metric';

export const EvaluationRunnerSchema = z.enum([
  'conversation',
  'interest_understanding',
  'candidate_supply',
  'daily_recommendation',
  'preference_learning',
]);
export type EvaluationRunner = z.infer<typeof EvaluationRunnerSchema>;

export const EvaluationProfileSchema = z.enum(['controlled', 'live']);
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

const StableReferenceIdSchema = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/);
const WorkspaceFileSchema = z.object({
  path: z.string().min(1).refine(isSafeRelativePath, 'Workspace file path must stay inside the Task Workspace.'),
  content: z.string(),
}).strict();
const SessionScenarioSchema = z.object({
  scenarioSessionId: StableReferenceIdSchema,
  title: z.string().min(1),
  turns: z.array(z.object({ user: z.string(), assistant: z.string() }).strict()).default([]),
}).strict();
const InterestScenarioSchema = z.object({
  scenarioInterestId: StableReferenceIdSchema,
  description: z.string().min(1).max(1_000),
  status: z.enum(['active', 'paused']).default('active'),
}).strict();
const CandidateScenarioSchema = z.object({
  scenarioCandidateId: StableReferenceIdSchema,
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  contentText: z.string().optional(),
  matchedInterestScenarioIds: z.array(StableReferenceIdSchema),
  relevance: z.enum(['direct', 'adjacent', 'exploration']),
}).strict();
const RecommendationScenarioSchema = z.object({
  scenarioRecommendationId: StableReferenceIdSchema,
  candidateScenarioId: StableReferenceIdSchema,
  reason: z.string().min(1),
  reaction: z.enum(['liked', 'disliked', 'none']).default('none'),
}).strict();
const PreferenceScenarioSchema = z.object({
  scopeKey: z.string().min(1),
  directionId: z.string().min(1),
  polarity: z.enum(['positive', 'negative']),
  dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality']),
  statement: z.string().min(1),
  supportingRecommendationScenarioIds: z.array(StableReferenceIdSchema).min(1),
}).strict();
const ControlledSearchScenarioSchema = z.object({
  sourceId: z.string().min(1),
  queryIncludes: z.string(),
  results: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    snippet: z.string().optional(),
    content: z.string().optional(),
  }).strict()),
}).strict();

export const EvaluationScenarioSchema = z.object({
  clock: z.string().datetime({ offset: true }),
  dailyTargetCount: z.number().int().min(1).max(100).default(3),
  workspace: z.object({ files: z.array(WorkspaceFileSchema).default([]) }).strict(),
  sessions: z.array(SessionScenarioSchema).default([]),
  interests: z.array(InterestScenarioSchema).default([]),
  candidates: z.array(CandidateScenarioSchema).default([]),
  recommendations: z.array(RecommendationScenarioSchema).default([]),
  preferences: z.array(PreferenceScenarioSchema).default([]),
  controlledSearch: z.array(ControlledSearchScenarioSchema).default([]),
  permissionDecision: z.enum(['allow', 'deny', 'ask']).default('allow'),
}).strict();
export type EvaluationScenario = z.infer<typeof EvaluationScenarioSchema>;

const CommonTaskShape = {
  taskId: StableEvaluationIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  difficulty: z.enum(['simple', 'medium', 'complex']),
  profiles: z.array(EvaluationProfileSchema).min(1),
  tags: z.array(StableEvaluationIdSchema).default([]),
  scenario: EvaluationScenarioSchema,
  metrics: z.array(EvaluationMetricSchema).min(1),
};

const ConversationTaskSchema = z.object({
  ...CommonTaskShape,
  runner: z.literal('conversation'),
  steps: z.array(z.object({
    userInput: z.string().min(1),
    permissionMode: z.enum(['ask', 'auto', 'full_access']).default('auto'),
  }).strict()).min(1),
  completion: z.object({
    kind: z.literal('conversation_steps_terminal'),
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

const InterestUnderstandingTaskSchema = z.object({
  ...CommonTaskShape,
  runner: z.literal('interest_understanding'),
  input: z.object({ kind: z.literal('completed_conversation_turn'), text: z.string().min(1) }).strict(),
  completion: z.object({
    kind: z.literal('interest_understanding_terminal'),
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

const CandidateSupplyTaskSchema = z.object({
  ...CommonTaskShape,
  runner: z.literal('candidate_supply'),
  input: z.object({ kind: z.literal('request_candidate_supply') }).strict(),
  completion: z.object({
    kind: z.literal('candidate_supply_terminal'),
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

const DailyRecommendationTaskSchema = z.object({
  ...CommonTaskShape,
  runner: z.literal('daily_recommendation'),
  input: z.object({ kind: z.literal('ensure_daily') }).strict(),
  completion: z.object({
    kind: z.literal('daily_batch_terminal'),
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

const PreferenceLearningTaskSchema = z.object({
  ...CommonTaskShape,
  runner: z.literal('preference_learning'),
  input: z.object({
    kind: z.literal('update_recommendation_feedback'),
    recommendationId: StableReferenceIdSchema,
    reaction: z.enum(['liked', 'disliked', 'none']),
  }).strict(),
  completion: z.object({
    kind: z.literal('preference_learning_settled'),
    timeoutMs: z.number().int().positive(),
  }).strict(),
}).strict();

export const EvaluationTaskSchema = z.discriminatedUnion('runner', [
  ConversationTaskSchema,
  InterestUnderstandingTaskSchema,
  CandidateSupplyTaskSchema,
  DailyRecommendationTaskSchema,
  PreferenceLearningTaskSchema,
]).superRefine((task, context) => {
  const metricIds = new Set<string>();
  for (const [index, metric] of task.metrics.entries()) {
    if (metricIds.has(metric.metricId)) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', index, 'metricId'],
        message: `Metric ID is duplicated: ${metric.metricId}.`,
      });
    }
    metricIds.add(metric.metricId);
  }
  uniqueValues(
    task.scenario.workspace.files.map((entry) => entry.path),
    ['scenario', 'workspace', 'files'],
    'Workspace file path',
    context,
  );
  uniqueValues(
    task.scenario.sessions.map((entry) => entry.scenarioSessionId),
    ['scenario', 'sessions'],
    'Scenario Session ID',
    context,
  );
  const interestIds = uniqueValues(
    task.scenario.interests.map((entry) => entry.scenarioInterestId),
    ['scenario', 'interests'],
    'Scenario Interest ID',
    context,
  );
  const candidateIds = uniqueValues(
    task.scenario.candidates.map((entry) => entry.scenarioCandidateId),
    ['scenario', 'candidates'],
    'Scenario Candidate ID',
    context,
  );
  const recommendationIds = uniqueValues(
    task.scenario.recommendations.map((entry) => entry.scenarioRecommendationId),
    ['scenario', 'recommendations'],
    'Scenario Recommendation ID',
    context,
  );
  for (const [candidateIndex, candidate] of task.scenario.candidates.entries()) {
    for (const [referenceIndex, interestId] of candidate.matchedInterestScenarioIds.entries()) {
      addMissingReference(
        interestIds,
        interestId,
        ['scenario', 'candidates', candidateIndex, 'matchedInterestScenarioIds', referenceIndex],
        'Interest',
        context,
      );
    }
  }
  for (const [recommendationIndex, recommendation] of task.scenario.recommendations.entries()) {
    addMissingReference(
      candidateIds,
      recommendation.candidateScenarioId,
      ['scenario', 'recommendations', recommendationIndex, 'candidateScenarioId'],
      'Candidate',
      context,
    );
  }
  for (const [preferenceIndex, preference] of task.scenario.preferences.entries()) {
    for (const [referenceIndex, recommendationId] of preference.supportingRecommendationScenarioIds.entries()) {
      addMissingReference(
        recommendationIds,
        recommendationId,
        ['scenario', 'preferences', preferenceIndex, 'supportingRecommendationScenarioIds', referenceIndex],
        'Recommendation',
        context,
      );
    }
  }
});

export type EvaluationTask = z.infer<typeof EvaluationTaskSchema>;

/** Maps a Runner ID to its task storage directory. */
export function evaluationRunnerDirectory(runner: EvaluationRunner): string {
  return runner.replaceAll('_', '-');
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
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `${label} is duplicated: ${value}.`,
      });
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
  context.addIssue({
    code: 'custom',
    path: [...path],
    message: `${label} Scenario reference does not exist: ${reference}.`,
  });
}
