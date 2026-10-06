/*
 * Defines shared content, its analysis, and the interest-match relation.
 * One `contents` row owns the source text and every pool reuses the same
 * analysis; deduplication keeps at most one candidate per duplicate group.
 */
import { z } from 'zod';
import { InterestIdSchema } from '../interests/interest-contracts';

export const ContentTypeSchema = z.enum([
  'news',
  'article',
  'discussion',
  'video',
  'paper',
  'project',
  'tutorial',
  'opinion',
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const LongTermValueSchema = z.enum(['none', 'learning', 'reference', 'practical']);
export type LongTermValue = z.infer<typeof LongTermValueSchema>;

/** One key point plus the source fragment that supports it. */
export const KeyPointSchema = z
  .object({ text: z.string().trim().min(1), evidence: z.string().trim().min(1) })
  .strict();
export type KeyPoint = z.infer<typeof KeyPointSchema>;

/** Finite numeric vector produced by the embedding model in one vector space. */
export const ContentEmbeddingSchema = z
  .object({
    embedding: z.array(z.number().finite()).min(1),
    embeddingModel: z.string().trim().min(1),
  })
  .strict();
export type ContentEmbedding = z.infer<typeof ContentEmbeddingSchema>;

export const AnalysisStatusSchema = z.enum(['pending', 'ready', 'failed']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

/**
 * The eight business results the text model produces for one content plus the
 * program-managed processing state. Text analysis and embedding are stored
 * separately so an embedding failure never invalidates a ready text analysis.
 */
export const ContentAnalysisSchema = z
  .object({
    contentId: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    keyPoints: z.array(KeyPointSchema).optional(),
    topics: z.array(z.string().trim().min(1)).optional(),
    entities: z.array(z.string().trim().min(1)).optional(),
    contentType: ContentTypeSchema.optional(),
    qualityScore: z.number().min(0).max(1).optional(),
    spamScore: z.number().min(0).max(1).optional(),
    longTermValue: LongTermValueSchema.optional(),
    embedding: z.array(z.number().finite()).min(1).optional(),
    embeddingModel: z.string().trim().min(1).optional(),
    status: AnalysisStatusSchema,
    attempts: z.number().int().nonnegative(),
    retryAt: z.number().int().nonnegative().optional(),
    lastErrorCode: z.string().trim().min(1).optional(),
    analyzedAt: z.number().int().nonnegative().optional(),
    embeddingRetryAt: z.number().int().nonnegative().optional(),
    embeddingErrorCode: z.string().trim().min(1).optional(),
  })
  .strict();
export type ContentAnalysis = z.infer<typeof ContentAnalysisSchema>;

/** Source text and identity of one piece of content. */
export const ContentSchema = z
  .object({
    id: z.string().trim().min(1),
    source: z.string().trim().min(1),
    canonicalUrl: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    author: z.string().trim().min(1).optional(),
    publishedAt: z.number().int().nonnegative().optional(),
    text: z.string().min(1),
    language: z.string().trim().min(1).optional(),
    duplicateGroupId: z.string().trim().min(1).optional(),
    duplicateConfidence: z.number().min(0).max(1).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Content = z.infer<typeof ContentSchema>;

export const InterestRelationSchema = z.enum(['direct', 'related', 'none']);
export type InterestRelation = z.infer<typeof InterestRelationSchema>;

/**
 * Relation between one content and one interest. A saved `none` means the pair
 * was judged; a missing row means it was not judged yet.
 */
export const InterestMatchSchema = z
  .object({
    contentId: z.string().trim().min(1),
    interestId: InterestIdSchema,
    relation: InterestRelationSchema,
    basis: z.string().trim().min(1).optional(),
    matchedAt: z.number().int().nonnegative(),
  })
  .strict();
export type InterestMatch = z.infer<typeof InterestMatchSchema>;

/**
 * The eight business results a text model must return for one content.
 * Program-managed state is never part of a model result.
 */
export const ContentAnalysisResultSchema = z
  .object({
    summary: z.string().trim().min(1),
    keyPoints: z.array(KeyPointSchema),
    topics: z.array(z.string().trim().min(1)),
    entities: z.array(z.string().trim().min(1)),
    contentType: ContentTypeSchema,
    qualityScore: z.number().min(0).max(1),
    spamScore: z.number().min(0).max(1),
    longTermValue: LongTermValueSchema,
  })
  .strict();
export type ContentAnalysisResult = z.infer<typeof ContentAnalysisResultSchema>;

/** Interest relations a text model may return together with the analysis. */
export const ContentAnalysisMatchSchema = z
  .object({
    interestId: InterestIdSchema,
    relation: InterestRelationSchema,
    basis: z.string().trim().min(1).optional(),
  })
  .strict();
export type ContentAnalysisMatch = z.infer<typeof ContentAnalysisMatchSchema>;
