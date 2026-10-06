/*
 * Defines candidate-pool qualifications, the read-only candidate snapshot, and
 * the supply-health view. Both pools share one content library; a duplicate
 * group contributes at most one candidate per pool.
 */
import { z } from 'zod';
import { ContentAnalysisResultSchema } from '../content/content-contracts';
import { InterestIdSchema, InterestSnapshotEntrySchema } from '../interests/interest-contracts';

export const CandidatePoolSchema = z.enum(['daily', 'long_term']);
export type CandidatePool = z.infer<typeof CandidatePoolSchema>;

export const CandidateStatusSchema = z.enum(['active', 'inactive']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

/** Why a pool relation stopped qualifying. Active relations have no reason. */
export const InactiveReasonSchema = z.enum(['expired', 'unrelated', 'excluded', 'unsuitable']);
export type InactiveReason = z.infer<typeof InactiveReasonSchema>;

/** One content's qualification in one pool. */
export const CandidateSchema = z
  .object({
    pool: CandidatePoolSchema,
    contentId: z.string().trim().min(1),
    status: CandidateStatusSchema,
    inactiveReason: InactiveReasonSchema.optional(),
    expiresAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * Analysis handed to recommendation generation: the eight business results
 * plus the optional vector. Processing state stays inside Candidate Supply.
 */
export const CandidateAnalysisSchema = ContentAnalysisResultSchema.extend({
  embedding: z.array(z.number().finite()).min(1).optional(),
  embeddingModel: z.string().trim().min(1).optional(),
});
export type CandidateAnalysis = z.infer<typeof CandidateAnalysisSchema>;

/** One deduplicated candidate with everything recommendation generation reads. */
export const CandidateSnapshotItemSchema = z
  .object({
    contentId: z.string().trim().min(1),
    duplicateContentIds: z.array(z.string().trim().min(1)),
    title: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1),
    source: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    publishedAt: z.number().int().nonnegative().optional(),
    analysis: CandidateAnalysisSchema,
    interestMatches: z.array(
      z
        .object({
          interestId: InterestIdSchema,
          relation: z.enum(['direct', 'related']),
          basis: z.string().trim().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type CandidateSnapshotItem = z.infer<typeof CandidateSnapshotItemSchema>;

/** Per-interest count used by `counts` and `deficits`. */
export const InterestCountSchema = z
  .object({ interestId: InterestIdSchema, count: z.number().int().nonnegative() })
  .strict();
export type InterestCount = z.infer<typeof InterestCountSchema>;

/** What one read or preparation run actually sees at `evaluatedAt`. */
export const CandidateSnapshotSchema = z
  .object({
    pool: CandidatePoolSchema,
    interests: z.array(InterestSnapshotEntrySchema),
    usageRevision: z.string(),
    evaluatedAt: z.number().int().nonnegative(),
    candidates: z.array(CandidateSnapshotItemSchema),
    counts: z
      .object({ total: z.number().int().nonnegative(), byInterest: z.array(InterestCountSchema) })
      .strict(),
    deficits: z
      .object({ total: z.number().int().nonnegative(), byInterest: z.array(InterestCountSchema) })
      .strict(),
    matchingPending: z.boolean(),
  })
  .strict();
export type CandidateSnapshot = z.infer<typeof CandidateSnapshotSchema>;

export const SupplyLevelSchema = z.enum(['empty', 'low', 'healthy']);
export type SupplyLevel = z.infer<typeof SupplyLevelSchema>;

/**
 * Supply health for one pool, or for one pool plus one interest. Counts are
 * computed from business data; there is no stored health table.
 */
export const SupplyHealthSchema = z
  .object({
    pool: CandidatePoolSchema,
    interestId: InterestIdSchema.optional(),
    activeCandidates: z.number().int().nonnegative(),
    freshCandidates: z.number().int().nonnegative().nullable(),
    avgQuality: z.number().min(0).max(1).nullable(),
    newestPublishedAt: z.number().int().nonnegative().nullable(),
    recentNewItems: z.number().int().nonnegative(),
    supplyLevel: SupplyLevelSchema,
    minimumDeficit: z.number().int().nonnegative(),
    targetDeficit: z.number().int().nonnegative(),
  })
  .strict();
export type SupplyHealth = z.infer<typeof SupplyHealthSchema>;
