/*
 * Defines Candidate Supply's business entities, results, and persistence contract.
 */
import { z } from 'zod';
import {
  DiscoveryContentTypeSchema,
  SourceContentSchema,
  SourceContentDetailSchema,
  SourceSearchModeSchema,
} from '../sources/discovery-source';
import type { SourceContentDetail } from '../sources/discovery-source';

const TimestampSchema = z.string().datetime({ offset: true });

export const CandidateStatusSchema = z.enum(['available', 'consumed', 'expired']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CandidateRelevanceSchema = z.enum(['direct', 'adjacent', 'exploration']);
export type CandidateRelevance = z.infer<typeof CandidateRelevanceSchema>;

export const CandidateSchema = z.object({
  id: z.string().min(1),
  contentIdentity: z.string().min(1),
  sourceId: z.string().min(1),
  sourceContentId: z.string().min(1).optional(),
  canonicalUrl: z.string().url(),
  contentType: DiscoveryContentTypeSchema,
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  publishedAt: TimestampSchema.optional(),
  description: z.string().trim().min(1).optional(),
  contentSummary: z.string().trim().min(1).max(1000),
  contentExcerpt: z.string().trim().min(1).optional(),
  contentTruncated: z.boolean(),
  coverUrl: z.string().url().optional(),
  status: CandidateStatusSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict();
export type Candidate = z.infer<typeof CandidateSchema>;

export const CandidateInterestMatchSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  interestId: z.string().min(1),
  relevance: CandidateRelevanceSchema,
  matchReason: z.string().trim().min(1).max(1000),
}).strict();
export type CandidateInterestMatch = z.infer<typeof CandidateInterestMatchSchema>;

export interface CandidateWithMatches {
  readonly candidate: Candidate;
  readonly interestMatches: readonly CandidateInterestMatch[];
}

export interface CandidatePoolSettings {
  readonly minimumCount: number;
  readonly targetCount: number;
  readonly maximumCount: number;
  readonly candidateValidityDays: number;
  readonly candidateContentExcerptMaxCharacters: number;
}

export interface CandidatePoolSnapshot {
  readonly asOf: string;
  readonly minimumCount: number;
  readonly targetCount: number;
  readonly maximumCount: number;
  readonly availableCount: number;
  readonly minimumShortfall: number;
  readonly targetShortfall: number;
  readonly availableByInterest: Readonly<Record<string, number>>;
  readonly candidates: readonly CandidateWithMatches[];
}

export const CandidatePoolSnapshotSchema: z.ZodType<CandidatePoolSnapshot> = z.object({
  asOf: TimestampSchema,
  minimumCount: z.number().int().positive(),
  targetCount: z.number().int().positive(),
  maximumCount: z.number().int().positive(),
  availableCount: z.number().int().nonnegative(),
  minimumShortfall: z.number().int().nonnegative(),
  targetShortfall: z.number().int().nonnegative(),
  availableByInterest: z.record(z.string(), z.number().int().nonnegative()),
  candidates: z.array(z.object({
    candidate: CandidateSchema,
    interestMatches: z.array(CandidateInterestMatchSchema),
  }).strict()),
}).strict();

export interface CandidateIdentity {
  readonly sourceId: string;
  readonly sourceContentId?: string;
  readonly canonicalUrl: string;
  readonly contentIdentity: string;
}

export interface SubmitCandidateRequest {
  readonly content: SourceContentDetail;
  readonly contentSummary: string;
  readonly matches: readonly {
    readonly interestId: string;
    readonly relevance: CandidateRelevance;
    readonly matchReason: string;
  }[];
  readonly settings: CandidatePoolSettings;
}

export type CandidateSubmissionResult =
  | {
      readonly status: 'created' | 'matched_existing';
      readonly candidate: Candidate;
      readonly interestMatches: readonly CandidateInterestMatch[];
      readonly addedCandidateCount: number;
      readonly addedInterestMatchCount: number;
    }
  | {
      readonly status: 'ignored';
      readonly reason:
        | 'capacity_reached'
        | 'duplicate_match'
        | 'no_active_interest'
        | 'terminal_duplicate';
      readonly addedCandidateCount: 0;
      readonly addedInterestMatchCount: 0;
    };

export interface CandidateSupplyRepository {
  /** Reads one Candidate and lazily expires it when required. */
  findCandidateById(id: string): CandidateWithMatches | undefined;
  /** Reads one Candidate by any deterministic identity. */
  findCandidateByIdentity(identity: CandidateIdentity): CandidateWithMatches | undefined;
  /** Reads the current derived Candidate Pool and lazily expires its read range. */
  readCandidatePoolSnapshot(settings: CandidatePoolSettings): CandidatePoolSnapshot;
  /** Atomically validates, deduplicates, capacity-checks, and persists one Candidate submission. */
  submitCandidate(request: SubmitCandidateRequest): CandidateSubmissionResult;
}

export type CandidateSupplyTrigger =
  | 'startup'
  | 'scheduled'
  | 'interest_changed'
  | 'supply_conditions_changed';

export interface CandidateSupplyResultBase {
  readonly requestId: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly addedCandidateCount: number;
  readonly addedInterestMatchCount: number;
}

export type CandidateSupplyResult =
  | CandidateSupplyResultBase & {
      readonly status: 'not_needed';
      readonly reason: 'no_gap' | 'no_active_interest' | 'supply_in_progress';
    }
  | CandidateSupplyResultBase & {
      readonly status: 'fulfilled';
      readonly executionId: string;
      readonly availableCount: number;
      readonly remainingReplenishmentCount: 0;
    }
  | CandidateSupplyResultBase & {
      readonly status: 'partially_fulfilled';
      readonly executionId: string;
      readonly availableCount: number;
      readonly remainingReplenishmentCount: number;
      readonly reason: 'no_more_result' | 'no_related_content' | 'sources_exhausted';
    }
  | CandidateSupplyResultBase & {
      readonly status: 'unfulfilled';
      readonly executionId?: string;
      readonly availableCount: number;
      readonly remainingReplenishmentCount: number;
      readonly reason:
        | 'no_available_source'
        | 'no_search_result'
        | 'no_related_content'
        | 'sources_exhausted';
    }
  | CandidateSupplyResultBase & {
      readonly status: 'failed';
      readonly executionId?: string;
      readonly availableCount?: number;
      readonly remainingReplenishmentCount?: number;
      readonly failure: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    }
  | CandidateSupplyResultBase & {
      readonly status: 'cancelled';
      readonly executionId: string;
      readonly availableCount: number;
      readonly remainingReplenishmentCount: number;
    };

const CandidateSupplyResultBaseSchema = z.object({
  requestId: z.string().min(1),
  trigger: z.enum(['startup', 'scheduled', 'interest_changed', 'supply_conditions_changed']),
  requestedAt: TimestampSchema,
  completedAt: TimestampSchema,
  addedCandidateCount: z.number().int().nonnegative(),
  addedInterestMatchCount: z.number().int().nonnegative(),
});
const CandidateSupplyProgressSchema = z.object({
  executionId: z.string().min(1),
  availableCount: z.number().int().nonnegative(),
  remainingReplenishmentCount: z.number().int().nonnegative(),
});

export const CandidateSupplyResultSchema: z.ZodType<CandidateSupplyResult> = z.discriminatedUnion('status', [
  CandidateSupplyResultBaseSchema.extend({
    status: z.literal('not_needed'),
    reason: z.enum(['no_gap', 'no_active_interest', 'supply_in_progress']),
  }).strict(),
  CandidateSupplyResultBaseSchema.merge(CandidateSupplyProgressSchema).extend({
    status: z.literal('fulfilled'),
    remainingReplenishmentCount: z.literal(0),
  }).strict(),
  CandidateSupplyResultBaseSchema.merge(CandidateSupplyProgressSchema).extend({
    status: z.literal('partially_fulfilled'),
    reason: z.enum(['no_more_result', 'no_related_content', 'sources_exhausted']),
  }).strict(),
  CandidateSupplyResultBaseSchema.merge(CandidateSupplyProgressSchema.omit({ executionId: true })).extend({
    status: z.literal('unfulfilled'),
    executionId: z.string().min(1).optional(),
    reason: z.enum(['no_available_source', 'no_search_result', 'no_related_content', 'sources_exhausted']),
  }).strict(),
  CandidateSupplyResultBaseSchema.extend({
    status: z.literal('failed'),
    executionId: z.string().min(1).optional(),
    availableCount: z.number().int().nonnegative().optional(),
    remainingReplenishmentCount: z.number().int().nonnegative().optional(),
    failure: z.object({
      code: z.string().min(1),
      message: z.string(),
      retryable: z.boolean(),
    }).strict(),
  }).strict(),
  CandidateSupplyResultBaseSchema.merge(CandidateSupplyProgressSchema).extend({
    status: z.literal('cancelled'),
  }).strict(),
]);

export const CandidateSupplySearchInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(200),
  mode: SourceSearchModeSchema,
  limit: z.number().int().min(1).max(20),
  targetInterestIds: z.array(z.string().min(1)),
}).strict();
export type CandidateSupplySearchInput = z.infer<typeof CandidateSupplySearchInputSchema>;

export const CandidateSupplySubmitInputSchema = z.object({
  items: z.array(z.object({
    resultId: z.string().min(1),
    contentSummary: z.string().trim().min(1).max(1000),
    matches: z.array(z.object({
      interestId: z.string().min(1),
      relevance: CandidateRelevanceSchema,
      matchReason: z.string().trim().min(1).max(1000),
    }).strict()).min(1),
  }).strict()).min(1).max(50),
}).strict();
export type CandidateSupplySubmitInput = z.infer<typeof CandidateSupplySubmitInputSchema>;

export { SourceContentDetailSchema, SourceContentSchema };
