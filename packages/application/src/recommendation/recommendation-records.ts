/* Defines typed snapshots and result records; generation remains outside the P1 storage foundation. */
import { z } from 'zod';
import { InterestSnapshotEntrySchema } from './interests/interest-contracts';
import { EvidenceSchema, PublicationEvidenceSchema } from './content/material-contracts';
import { AttemptOwnershipSchema, RecommendationIssueSchema } from './discovery/discovery-records';
const IdSchema = z.string().min(1);
const TimeSchema = z.number().int().nonnegative();
const InterestVersionSchema = z.object({ interestId: IdSchema, revision: z.number().int().positive() }).strict();

export const CandidateInputSnapshotSchema = z.array(z.object({
  contentId: IdSchema,
  materialId: IdSchema,
  interests: z.array(InterestVersionSchema).min(1),
  analysisContractVersion: z.number().int().positive(),
  matchingContractVersion: z.number().int().positive(),
  originalOrder: z.number().int().nonnegative()
}).strict());

export const DailyFeedBatchRecordSchema = z.object({
  id: IdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: IdSchema,
  interestId: IdSchema,
  interestRevision: z.number().int().positive(),
  interestText: z.string().min(1),
  windowStart: TimeSchema,
  windowEnd: TimeSchema,
  status: z.enum(['ready', 'partial', 'empty', 'failed']),
  committedAt: TimeSchema,
  issues: z.array(RecommendationIssueSchema)
}).strict().refine(
  (batch) => batch.windowEnd > batch.windowStart,
  'The date window must have positive duration.'
);

export const DailyFeedItemRecordSchema = z.object({
  batchId: IdSchema,
  contentId: IdSchema,
  materialId: IdSchema,
  displayOrder: z.number().int().nonnegative(),
  titleSnapshot: z.string(),
  summarySnapshot: z.string(),
  publicationSnapshot: z.array(PublicationEvidenceSchema)
}).strict();

export const CuratedSelectionRecordSchema = z.object({
  id: IdSchema,
  interestSnapshot: z.array(InterestSnapshotEntrySchema),
  createdAt: TimeSchema,
  status: z.enum(['ready', 'retired'])
}).strict();

export const CuratedSelectionItemRecordSchema = z.object({
  selectionId: IdSchema,
  contentId: IdSchema,
  materialId: IdSchema,
  displayOrder: z.number().int().nonnegative(),
  matchedInterests: z.array(InterestVersionSchema).min(1),
  reason: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1)
}).strict();

export const FavoriteRecordSchema = z.object({
  contentId: IdSchema,
  materialId: IdSchema,
  titleSnapshot: z.string(),
  createdAt: TimeSchema
}).strict();

export const RecommendationRunRecordSchema = z.object({
  id: IdSchema,
  kind: z.enum(['daily_feed', 'curated']),
  requestId: IdSchema,
  retryOfRunId: IdSchema.nullable(),
  inputHash: IdSchema,
  status: z.enum([
    'running',
    'completed',
    'partial',
    'failed',
    'cancelled',
    'interrupted',
    'input_changed'
  ]),
  interestSnapshot: z.array(InterestSnapshotEntrySchema),
  candidateSnapshot: CandidateInputSnapshotSchema,
  resultId: IdSchema.nullable(),
  outcome: z.object({
    committedContentIds: z.array(IdSchema),
    issues: z.array(RecommendationIssueSchema)
  }).strict().nullable(),
  error: RecommendationIssueSchema.nullable(),
  startedAt: TimeSchema,
  finishedAt: TimeSchema.nullable(),
}).strict();
const JudgmentBase = {
  runId: IdSchema,
  contentId: IdSchema,
  interestId: IdSchema,
  materialId: IdSchema,
  inputHash: IdSchema,
  status: z.enum(['pending', 'running', 'ready', 'failed', 'cancelled']),
  attempts: z.number().int().nonnegative(),
  retryAt: TimeSchema.nullable(),
  errorCode: IdSchema.nullable(),
  ownership: AttemptOwnershipSchema
};

export const RecommendationJudgmentRecordSchema = z.discriminatedUnion('stage', [
  z.object({
    ...JudgmentBase,
    stage: z.literal('topic'),
    result: z.object({
      relation: z.enum(['related', 'unrelated', 'insufficient']),
      evidence: z.array(EvidenceSchema)
    }).strict().nullable()
  }).strict(),
  z.object({
    ...JudgmentBase,
    stage: z.literal('date'),
    result: z.object({ eligible: z.boolean(), publicationEvidence: z.array(PublicationEvidenceSchema) }).strict().nullable()
  }).strict(),
  z.object({
    ...JudgmentBase,
    stage: z.literal('value'),
    result: z.object({
      worthReading: z.boolean(),
      reason: z.string().min(1),
      evidence: z.array(EvidenceSchema),
      matchedInterestIds: z.array(IdSchema),
      rank: z.number().int().positive()
    }).strict().nullable()
  }).strict(),
]);
export type RecommendationRunRecord = z.infer<typeof RecommendationRunRecordSchema>;
export type RecommendationJudgmentRecord = z.infer<typeof RecommendationJudgmentRecordSchema>;
