/*
 * Defines Candidate Supply's durable business contracts without owning persistence or Agent execution.
 */
import { z } from 'zod';
import {
  DiscoveryContentTypeSchema,
  SourceContentDetailSchema,
  SourceContentSchema,
  SourceSearchModeSchema,
  type SourceContent,
  type SourceContentDetail,
} from '../sources/discovery-source';

const TimestampSchema = z.string().datetime({ offset: true });

export const CandidateStatusSchema = z.enum([
  'preparing',
  'pending_admission',
  'available',
  'reserved',
  'consumed',
  'rejected',
  'expired',
]);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CandidateRelevanceSchema = z.enum(['direct', 'adjacent', 'exploration', 'none']);
export type CandidateRelevance = z.infer<typeof CandidateRelevanceSchema>;

export const CandidateSchema = z.object({
  candidateId: z.string().min(1),
  contentIdentity: z.string().min(1),
  status: CandidateStatusSchema,
  primarySourceId: z.string().min(1),
  primarySourceName: z.string().min(1),
  sourceContentId: z.string().min(1).optional(),
  canonicalUrl: z.string().url(),
  contentType: DiscoveryContentTypeSchema,
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  publishedAt: TimestampSchema.optional(),
  description: z.string().trim().min(1).optional(),
  contentText: z.string().trim().min(1).optional(),
  coverUrl: z.string().url().optional(),
  firstSeenAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  expiresAt: TimestampSchema,
  statusUpdatedAt: TimestampSchema,
}).strict();
export type Candidate = z.infer<typeof CandidateSchema>;

const DecisionRevisionFields = {
  interestRevisions: z.array(z.object({
    interestId: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict()),
  preferenceRevisions: z.array(z.object({
    scopeKey: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict()),
  preferenceAlignment: z.array(z.object({
    directionId: z.string().min(1),
    relation: z.enum(['aligned', 'conflicted', 'neutral']),
    reason: z.string().trim().min(1).max(1000),
  }).strict()),
};

export const CandidateAdmissionDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    candidateId: z.string().min(1),
    decision: z.literal('admit'),
    relevance: z.enum(['direct', 'adjacent', 'exploration']),
    matchedInterestIds: z.array(z.string().min(1)),
    contentValue: z.literal('substantive'),
    novelty: z.literal('novel'),
    temporalValidity: z.literal('valid'),
    negativeConstraint: z.literal('clear'),
    ...DecisionRevisionFields,
    reason: z.string().trim().min(1).max(1000),
  }).strict(),
  z.object({
    candidateId: z.string().min(1),
    decision: z.literal('needs_detail'),
    reason: z.string().trim().min(1).max(1000),
  }).strict(),
  z.object({
    candidateId: z.string().min(1),
    decision: z.literal('reject'),
    relevance: CandidateRelevanceSchema,
    matchedInterestIds: z.array(z.string().min(1)),
    contentValue: z.enum(['substantive', 'low_value']),
    novelty: z.enum(['novel', 'semantic_duplicate']),
    temporalValidity: z.enum(['valid', 'stale', 'uncertain']),
    negativeConstraint: z.enum(['clear', 'conflict']),
    ...DecisionRevisionFields,
    duplicateOfCandidateId: z.string().min(1).optional(),
    duplicateOfRecommendationId: z.string().min(1).optional(),
    reasonCode: z.enum([
      'insufficient_content',
      'unrelated',
      'low_value',
      'semantic_duplicate',
      'stale',
      'negative_constraint',
    ]),
    reason: z.string().trim().min(1).max(1000),
  }).strict(),
]);
export type CandidateAdmissionDecision = z.infer<typeof CandidateAdmissionDecisionSchema>;

export interface CandidateSupplyThresholds {
  readonly lowWatermark: number;
  readonly target: number;
  readonly hardLimit: number;
}

export interface CandidatePoolGap {
  readonly totalShortfall: number;
  readonly uncoveredInterestIds: readonly string[];
  readonly consumerShortfalls: readonly {
    readonly consumer: 'daily' | 'proactive';
    readonly count: number;
  }[];
}

export interface CandidatePoolSnapshot {
  readonly thresholds: CandidateSupplyThresholds;
  readonly counts: Readonly<Record<CandidateStatus, number>>;
  readonly activeCount: number;
  readonly gap: CandidatePoolGap;
  readonly pendingCandidates: readonly Candidate[];
  readonly nextRecheckAt?: string;
}

export interface CandidateQueryOutcome {
  readonly queryId: string;
  readonly executionId: string;
  readonly sourceId: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly mode: z.infer<typeof SourceSearchModeSchema>;
  readonly targetInterestIds: readonly string[];
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  readonly rawResultCount: number;
  readonly invalidResultCount: number;
  readonly newCandidateCount: number;
  readonly mergedCandidateCount: number;
  readonly alreadyRecommendedCount: number;
  readonly capacityRejectedCount: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failureCode?: string;
}

export interface CandidateMaterialResult {
  readonly query: CandidateQueryOutcome;
  readonly candidates: readonly Candidate[];
}

export interface CandidatePotentialDuplicate {
  readonly kind: 'candidate' | 'recommendation';
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export interface CandidateSupplyState {
  readonly consecutiveZeroYieldCount: number;
  readonly retryAt?: string;
  readonly nextRecheckAt?: string;
  readonly lastSettlement?: CandidateSupplySettlement;
  readonly updatedAt: string;
}

export const CandidateSupplySettlementSchema = z.object({
  executionId: z.string().min(1).optional(),
  reason: z.enum([
    'fulfilled',
    'budget_exhausted',
    'no_available_source',
    'zero_yield',
    'agent_failed',
    'cancelled',
  ]),
  remainingGap: z.object({
    totalShortfall: z.number().int().nonnegative(),
    uncoveredInterestIds: z.array(z.string().min(1)),
    consumerShortfalls: z.array(z.object({
      consumer: z.enum(['daily', 'proactive']),
      count: z.number().int().positive(),
    }).strict()),
  }).strict(),
  settledAt: TimestampSchema,
}).strict();
export type CandidateSupplySettlement = z.infer<typeof CandidateSupplySettlementSchema>;

export interface CandidateSourceState {
  readonly sourceId: string;
  readonly consecutiveFailureCount: number;
  readonly retryAt?: string;
  readonly lastFailureCode?: string;
  readonly updatedAt: string;
}

export interface CandidateSupplyRepository {
  beginQuery(input: {
    readonly queryId: string;
    readonly executionId: string;
    readonly sourceId: string;
    readonly query: string;
    readonly mode: 'relevance' | 'recent';
    readonly targetInterestIds: readonly string[];
    readonly startedAt: string;
  }): CandidateQueryOutcome;
  commitSearchResult(input: {
    readonly queryId: string;
    readonly completedAt: string;
    readonly items: readonly SourceContent[];
    readonly invalidResultCount?: number;
    readonly hardLimit: number;
  }): CandidateMaterialResult;
  failQuery(input: {
    readonly queryId: string;
    readonly status: 'failed' | 'cancelled' | 'interrupted';
    readonly completedAt: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): CandidateQueryOutcome;
  interruptRunningQueries(now: string): number;
  readCandidate(candidateId: string): Candidate | undefined;
  listPotentialDuplicates(candidateId: string, limit: number): readonly CandidatePotentialDuplicate[];
  listNegativeConstraints(): readonly string[];
  commitCandidateDetail(input: {
    readonly candidateId: string;
    readonly detail: SourceContentDetail;
    readonly now: string;
  }): Candidate;
  commitAdmission(input: {
    readonly executionId: string;
    readonly assessmentVersion: string;
    readonly assessedAt: string;
    readonly decisions: readonly CandidateAdmissionDecision[];
  }): readonly Candidate[];
  getPoolSnapshot(input: {
    readonly now: string;
    readonly dailyTargetCount: number;
    readonly proactiveTargetCount: number;
    readonly dailyShortfall?: number;
    readonly proactiveShortfall?: number;
  }): CandidatePoolSnapshot;
  listRecentQueryOutcomes(input: {
    readonly now: string;
    readonly withinDays: number;
    readonly limit: number;
  }): readonly CandidateQueryOutcome[];
  isQueryCoolingDown(input: {
    readonly sourceId: string;
    readonly query: string;
    readonly mode: 'relevance' | 'recent';
    readonly targetInterestIds: readonly string[];
    readonly now: string;
  }): boolean;
  readSupplyState(): CandidateSupplyState | undefined;
  writeSupplyState(state: CandidateSupplyState): void;
  readSourceState(sourceId: string): CandidateSourceState | undefined;
  settleSourceAttempt(input: {
    readonly sourceId: string;
    readonly result: 'success' | 'failed' | 'cancelled' | 'persistence_error';
    readonly failureCode?: string;
    readonly providerRetryAt?: string;
    readonly now: string;
  }): CandidateSourceState;
  invalidateAdmissions(input: {
    readonly interestIds: readonly string[];
    readonly now: string;
  }): number;
}

export interface CandidateSupplyContextSource {
  getSnapshot(now: string): CandidatePoolSnapshot;
}

export const CandidateSupplySearchInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(200),
  mode: SourceSearchModeSchema,
  limit: z.number().int().min(1).max(20),
  targetInterestIds: z.array(z.string().min(1)),
}).strict();
export type CandidateSupplySearchInput = z.infer<typeof CandidateSupplySearchInputSchema>;

export const CandidateSupplyCommitInputSchema = z.object({
  decisions: z.array(CandidateAdmissionDecisionSchema).min(1).max(50),
}).strict();
export type CandidateSupplyCommitInput = z.infer<typeof CandidateSupplyCommitInputSchema>;

export { SourceContentDetailSchema, SourceContentSchema };
