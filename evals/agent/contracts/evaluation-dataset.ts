/*
 * Defines the author-facing Dataset and five fixed Case contracts used by Evaluation.
 */
import { z } from 'zod';
import { DiscoveryContentTypeSchema } from '@megumi/discovery';

export const StableEvaluationIdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
export const EvaluationEnvironmentKindSchema = z.enum(['controlled', 'live']);
export type EvaluationEnvironmentKind = z.infer<typeof EvaluationEnvironmentKindSchema>;

const TimestampSchema = z.string().datetime({ offset: true });
const ReferenceIdSchema = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u);
const SafeRelativePathSchema = z.string().min(1).refine(isSafeRelativePath, 'Path must stay inside the Dataset root.');
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const MetadataSchema = z.object({
  tags: z.array(StableEvaluationIdSchema).default([]),
  difficulty: z.enum(['simple', 'medium', 'complex']).optional(),
  source: z.string().trim().min(1).optional(),
  author: z.string().trim().min(1).optional(),
  reviewedBy: z.string().trim().min(1).optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
}).strict();

const InlineWorkspaceFileSchema = z.object({
  path: SafeRelativePathSchema,
  content: z.string(),
}).strict();
const AssetWorkspaceFileSchema = z.object({
  path: SafeRelativePathSchema,
  assetPath: SafeRelativePathSchema,
  checksum: Sha256Schema,
}).strict();
export const WorkspaceFileDataSchema = z.union([InlineWorkspaceFileSchema, AssetWorkspaceFileSchema]);
export type WorkspaceFileData = z.infer<typeof WorkspaceFileDataSchema>;

const ConversationTurnSchema = z.object({ user: z.string(), assistant: z.string() }).strict();
const SessionDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  title: z.string().trim().min(1),
  turns: z.array(ConversationTurnSchema).default([]),
  participation: z.enum(['included', 'excluded']).optional(),
  effectiveFrom: TimestampSchema.optional(),
}).strict();
const InterestDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  description: z.string().trim().min(1).max(1_000),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  createdFrom: z.enum(['manual', 'conversation']).optional(),
  revision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
  userManagedAt: TimestampSchema.optional(),
}).strict();
const CandidateDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  sourceId: z.string().trim().min(1),
  sourceName: z.string().trim().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  contentText: z.string().optional(),
  contentType: DiscoveryContentTypeSchema.optional(),
  sourceContentId: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  publishedAt: TimestampSchema.optional(),
  contentSummary: z.string().trim().min(1).max(1000).optional(),
  contentTruncated: z.boolean().optional(),
  coverUrl: z.string().url().optional(),
  status: z.enum(['available', 'consumed', 'expired']).optional(),
  createdAt: TimestampSchema.optional(),
  expiresAt: TimestampSchema.optional(),
  matchedInterestReferenceIds: z.array(ReferenceIdSchema),
  relevance: z.enum(['direct', 'adjacent', 'exploration']),
}).strict();
const RecommendationDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  candidateReferenceId: ReferenceIdSchema,
  reason: z.string().trim().min(1),
  reaction: z.enum(['liked', 'disliked', 'none']).default('none'),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  publishedAt: TimestampSchema.optional(),
  reactionRevision: z.number().int().nonnegative().optional(),
  reactionChangedAt: TimestampSchema.optional(),
  learnedReaction: z.enum(['liked', 'disliked', 'none']).optional(),
  learnedReactionRevision: z.number().int().nonnegative().optional(),
}).strict();
const PreferenceDataSchema = z.object({
  interestReferenceId: ReferenceIdSchema,
  id: z.string().trim().min(1),
  polarity: z.enum(['positive', 'negative']),
  dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality']),
  statement: z.string().trim().min(1),
  supportingRecommendationReferenceIds: z.array(ReferenceIdSchema).min(1),
}).strict();
const InterestEvidenceDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  interestReferenceId: ReferenceIdSchema.optional(),
  userTurnIndex: z.number().int().nonnegative(),
  description: z.string().trim().min(1).max(1000),
  effect: z.enum(['support', 'reject']),
  confidence: z.enum(['high', 'medium']),
  status: z.enum(['pending', 'applied', 'retracted']),
  createdAt: TimestampSchema.optional(),
}).strict();
const ControlledWebResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().optional(),
  content: z.string().optional(),
}).strict();
const ControlledWebDataSchema = z.object({
  sourceId: z.string().trim().min(1),
  queryIncludes: z.string(),
  results: z.array(ControlledWebResultSchema),
}).strict();
const ApprovalDecisionDataSchema = z.object({
  toolName: z.string().trim().min(1),
  decision: z.enum(['allow', 'deny']),
  occurrence: z.number().int().positive().default(1),
}).strict();

const CaseBaseShape = {
  schemaVersion: z.literal(2),
  caseId: StableEvaluationIdSchema,
  revision: z.number().int().positive(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  metadata: MetadataSchema.optional(),
};

export const ConversationCaseSchema = z.object({
  ...CaseBaseShape,
  type: z.literal('conversation'),
  initialState: z.object({
    clock: TimestampSchema,
    workspaceFiles: z.array(WorkspaceFileDataSchema).default([]),
    sessionHistory: z.array(SessionDataSchema).default([]),
    controlledWeb: z.array(ControlledWebDataSchema).default([]),
    approvalDecisions: z.array(ApprovalDecisionDataSchema).default([]),
  }).strict(),
  input: z.object({
    steps: z.array(z.object({
      userInput: z.string().min(1),
      permissionMode: z.enum(['ask', 'auto', 'full_access']).default('auto'),
    }).strict()).min(1),
  }).strict(),
  expected: z.object({
    requiredFiles: z.array(SafeRelativePathSchema).optional(),
    expectedFacts: z.array(z.string().min(1)).optional(),
    allowedOutcomes: z.array(z.enum(['completed', 'failed', 'cancelled'])).min(1).optional(),
  }).strict().optional(),
}).strict();

export const InterestUnderstandingCaseSchema = z.object({
  ...CaseBaseShape,
  type: z.literal('interest_understanding'),
  initialState: z.object({
    clock: TimestampSchema,
    sourceSession: SessionDataSchema,
    existingInterests: z.array(InterestDataSchema).default([]),
    existingEvidence: z.array(InterestEvidenceDataSchema).optional(),
  }).strict(),
  input: z.object({ text: z.string().min(1) }).strict(),
  expected: z.object({
    addedInterestDescriptions: z.array(z.string().min(1)).optional(),
    mergedInterestReferenceIds: z.array(ReferenceIdSchema).optional(),
    unchangedInterestReferenceIds: z.array(ReferenceIdSchema).optional(),
    noNewInterest: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export const CandidateSupplyCaseSchema = z.object({
  ...CaseBaseShape,
  type: z.literal('candidate_supply'),
  initialState: z.object({
    clock: TimestampSchema,
    minimumCount: z.number().int().positive(),
    maximumCount: z.number().int().min(2),
    interests: z.array(InterestDataSchema),
    existingCandidates: z.array(CandidateDataSchema).default([]),
    controlledSources: z.array(ControlledWebDataSchema).default([]),
  }).strict(),
  input: z.object({ trigger: z.literal('supply_conditions_changed') }).strict(),
  expected: z.object({
    relatedUrls: z.array(z.string().url()).optional(),
    duplicateUrls: z.array(z.string().url()).optional(),
    unrelatedUrls: z.array(z.string().url()).optional(),
    minimumCreatedCount: z.number().int().nonnegative().optional(),
  }).strict().optional(),
}).strict();

export const RecommendationCaseSchema = z.object({
  ...CaseBaseShape,
  type: z.literal('recommendation'),
  initialState: z.object({
    clock: TimestampSchema,
    recommendationTargetCount: z.number().int().min(1).max(100),
    recommendationWorkingSetCount: z.number().int().min(1).max(200),
    interests: z.array(InterestDataSchema),
    candidates: z.array(CandidateDataSchema),
    previousRecommendations: z.array(RecommendationDataSchema).default([]),
    preferences: z.array(PreferenceDataSchema).default([]),
  }).strict(),
  input: z.object({ trigger: z.literal('manual') }).strict(),
  expected: z.object({
    recommendableCandidateReferenceIds: z.array(ReferenceIdSchema).optional(),
    excludedCandidateReferenceIds: z.array(ReferenceIdSchema).optional(),
    allowedOutcomes: z.array(z.enum(['published', 'failed'])).min(1).optional(),
  }).strict().optional(),
}).strict();

const ReactionDataSchema = z.object({
  referenceId: ReferenceIdSchema,
  recommendationReferenceId: ReferenceIdSchema,
  reaction: z.enum(['liked', 'disliked', 'none']),
}).strict();

export const PreferenceLearningCaseSchema = z.object({
  ...CaseBaseShape,
  type: z.literal('preference_learning'),
  initialState: z.object({
    clock: TimestampSchema,
    interests: z.array(InterestDataSchema).min(1),
    candidates: z.array(CandidateDataSchema).min(1),
    recommendations: z.array(RecommendationDataSchema).min(1),
    existingReactions: z.array(ReactionDataSchema).default([]),
    preferences: z.array(PreferenceDataSchema).default([]),
  }).strict(),
  input: z.object({
    recommendationReferenceId: ReferenceIdSchema,
    reaction: z.enum(['liked', 'disliked', 'none']),
  }).strict(),
  expected: z.object({
    createdDirections: z.array(z.string().min(1)).optional(),
    revisedDirectionIds: z.array(z.string().min(1)).optional(),
    retainedDirectionIds: z.array(z.string().min(1)).optional(),
    retractedDirectionIds: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict();

const EvaluationCaseUnionSchema = z.discriminatedUnion('type', [
  ConversationCaseSchema,
  InterestUnderstandingCaseSchema,
  CandidateSupplyCaseSchema,
  RecommendationCaseSchema,
  PreferenceLearningCaseSchema,
]);
export type EvaluationCase = z.infer<typeof EvaluationCaseUnionSchema>;
export const EvaluationCaseSchema = EvaluationCaseUnionSchema.superRefine(validateCaseReferences);

export const EvaluationDatasetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  environmentKind: EvaluationEnvironmentKindSchema,
  datasetId: StableEvaluationIdSchema,
  revision: z.number().int().positive(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  caseIds: z.array(StableEvaluationIdSchema).min(1),
}).strict().superRefine((manifest, context) => {
  addDuplicateIssues(manifest.caseIds, ['caseIds'], 'Case ID', context);
});
export type EvaluationDatasetManifest = z.infer<typeof EvaluationDatasetManifestSchema>;

/** Returns the clock declared by any supported Case without widening its Initial State. */
export function evaluationCaseClock(evaluationCase: EvaluationCase): string {
  return evaluationCase.initialState.clock;
}

function validateCaseReferences(evaluationCase: EvaluationCase, context: z.RefinementCtx): void {
  if (evaluationCase.type === 'conversation') {
    addDuplicateIssues(evaluationCase.initialState.workspaceFiles.map((file) => file.path), ['initialState', 'workspaceFiles'], 'Workspace path', context);
    addDuplicateIssues(evaluationCase.initialState.sessionHistory.map((session) => session.referenceId), ['initialState', 'sessionHistory'], 'Session reference', context);
    return;
  }
  if (evaluationCase.type === 'interest_understanding') {
    addDuplicateIssues(evaluationCase.initialState.existingInterests.map((interest) => interest.referenceId), ['initialState', 'existingInterests'], 'Interest reference', context);
    const evidence = evaluationCase.initialState.existingEvidence ?? [];
    addDuplicateIssues(evidence.map(({ referenceId }) => referenceId), ['initialState', 'existingEvidence'], 'Evidence reference', context);
    for (const [index, entry] of evidence.entries()) {
      if (entry.interestReferenceId) addMissingReference(new Set(evaluationCase.initialState.existingInterests.map(({ referenceId }) => referenceId)), entry.interestReferenceId, ['initialState', 'existingEvidence', index], 'Interest', context);
      if (!evaluationCase.initialState.sourceSession.turns[entry.userTurnIndex]) context.addIssue({ code: 'custom', path: ['initialState', 'existingEvidence', index, 'userTurnIndex'], message: 'Evidence must reference an existing user turn.' });
    }
    return;
  }
  const interestReferences = evaluationCase.initialState.interests.map((interest) => interest.referenceId);
  addDuplicateIssues(interestReferences, ['initialState', 'interests'], 'Interest reference', context);
  const interests = new Set(interestReferences);
  const candidatePath = 'existingCandidates' in evaluationCase.initialState
    ? 'existingCandidates'
    : 'candidates';
  const candidates = 'existingCandidates' in evaluationCase.initialState
    ? evaluationCase.initialState.existingCandidates
    : evaluationCase.initialState.candidates;
  const candidateIds = new Set(candidates.map((candidate) => candidate.referenceId));
  addDuplicateIssues(candidates.map((candidate) => candidate.referenceId), ['initialState', candidatePath], 'Candidate reference', context);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    addDuplicateIssues(candidate.matchedInterestReferenceIds, ['initialState', candidatePath, candidateIndex, 'matchedInterestReferenceIds'], 'Interest match', context);
    for (const [referenceIndex, referenceId] of candidate.matchedInterestReferenceIds.entries()) {
      addMissingReference(interests, referenceId, ['initialState', candidatePath, candidateIndex, 'matchedInterestReferenceIds', referenceIndex], 'Interest', context);
    }
  }
  if (evaluationCase.type === 'candidate_supply') {
    const targetCount = Math.floor(evaluationCase.initialState.maximumCount * 0.8);
    if (evaluationCase.initialState.minimumCount >= targetCount) {
      context.addIssue({
        code: 'custom',
        path: ['initialState', 'minimumCount'],
        message: 'minimumCount must be smaller than the derived 80% targetCount.',
      });
    }
    return;
  }
  if (evaluationCase.type === 'recommendation'
    && evaluationCase.initialState.recommendationWorkingSetCount
      < evaluationCase.initialState.recommendationTargetCount) {
    context.addIssue({
      code: 'custom',
      path: ['initialState', 'recommendationWorkingSetCount'],
      message: 'recommendationWorkingSetCount cannot be smaller than recommendationTargetCount.',
    });
  }
  const recommendationPath = evaluationCase.type === 'recommendation'
    ? 'previousRecommendations'
    : 'recommendations';
  const recommendations = evaluationCase.type === 'recommendation'
    ? evaluationCase.initialState.previousRecommendations
    : evaluationCase.initialState.recommendations;
  const recommendationIds = new Set(recommendations.map((recommendation) => recommendation.referenceId));
  addDuplicateIssues(recommendations.map(({ referenceId }) => referenceId), ['initialState', recommendationPath], 'Recommendation reference', context);
  addDuplicateIssues(recommendations.map(({ candidateReferenceId }) => candidateReferenceId), ['initialState', recommendationPath], 'Recommended Candidate', context);
  addDuplicateIssues(evaluationCase.initialState.preferences.map(({ id }) => id), ['initialState', 'preferences'], 'Preference ID', context);
  for (const [index, recommendation] of recommendations.entries()) {
    addMissingReference(candidateIds, recommendation.candidateReferenceId, ['initialState', recommendationPath, index, 'candidateReferenceId'], 'Candidate', context);
  }
  for (const [preferenceIndex, preference] of evaluationCase.initialState.preferences.entries()) {
    addMissingReference(new Set(evaluationCase.initialState.interests.map((interest) => interest.referenceId)), preference.interestReferenceId,
      ['initialState', 'preferences', preferenceIndex, 'interestReferenceId'], 'Interest', context);
    for (const [referenceIndex, referenceId] of preference.supportingRecommendationReferenceIds.entries()) {
      addMissingReference(recommendationIds, referenceId, ['initialState', 'preferences', preferenceIndex, 'supportingRecommendationReferenceIds', referenceIndex], 'Recommendation', context);
    }
  }
  if (evaluationCase.type === 'preference_learning') {
    addDuplicateIssues(evaluationCase.initialState.existingReactions.map(({ recommendationReferenceId }) => recommendationReferenceId), ['initialState', 'existingReactions'], 'Reaction target', context);
    addMissingReference(recommendationIds, evaluationCase.input.recommendationReferenceId, ['input', 'recommendationReferenceId'], 'Recommendation', context);
    for (const [index, reaction] of evaluationCase.initialState.existingReactions.entries()) {
      addMissingReference(recommendationIds, reaction.recommendationReferenceId, ['initialState', 'existingReactions', index, 'recommendationReferenceId'], 'Recommendation', context);
    }
  }
}

function addDuplicateIssues(
  values: readonly string[],
  path: readonly (string | number)[],
  label: string,
  context: z.RefinementCtx,
): void {
  const unique = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (unique.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message: `${label} is duplicated: ${value}.` });
    unique.add(value);
  }
}

function addMissingReference(
  values: ReadonlySet<string>,
  reference: string,
  path: readonly (string | number)[],
  label: string,
  context: z.RefinementCtx,
): void {
  if (values.has(reference)) return;
  context.addIssue({ code: 'custom', path: [...path], message: `${label} reference does not exist: ${reference}.` });
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/')
    && !/^[a-z]:\//iu.test(normalized)
    && normalized.split('/').every((segment) => segment !== '' && segment !== '..');
}
