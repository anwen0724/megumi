/*
 * Defines saved curated cards and the bounded value and comparison outputs.
 */
import { z } from 'zod';
import { ContentCardSchema } from './feed-contracts';
import { EvidenceSchema } from './content/material-contracts';
export const ValueJudgmentSchema = z.object({
  worthReading: z.boolean(),
  reason: z.string().min(1),
  evidence: z.array(EvidenceSchema),
  matchedInterestIds: z.array(z.string().min(1)),
}).strict();
export type ValueJudgment = z.infer<typeof ValueJudgmentSchema>;
export const SelectionItemSchema = ValueJudgmentSchema.omit({ worthReading: true }).extend({ contentId: z.string().min(1) }).strict();
export type SelectionItem = z.infer<typeof SelectionItemSchema>;
export const CuratedCardSchema = ContentCardSchema.extend({ reason: z.string(), evidence: z.array(EvidenceSchema) }).strict();
export const CuratedSelectionSchema = z.object({
  id: z.string(), createdAt: z.string().datetime(), items: z.array(CuratedCardSchema),
}).strict();
export type CuratedSelection = z.infer<typeof CuratedSelectionSchema>;
export const CuratedSelectionViewSchema = z.object({
  lastRun: z.string().optional(),
  selection: CuratedSelectionSchema.optional(), needsUpdate: z.boolean(), activeRun: z.string().optional(),
  supplyStatus: z.array(z.object({ interestId: z.string(), interestRevision: z.number(), eligibleCount: z.number(), shortage: z.number(), missingMaterial: z.number(), pendingAnalysis: z.number(), pendingMatching: z.number(), blocked: z.number() }).strict()),
}).strict();
export type CuratedSelectionView = z.infer<typeof CuratedSelectionViewSchema>;
export const StartCuratedSelectionRequestSchema = z.object({ requestId: z.string().min(1).max(128) }).strict();
export const StartCuratedSelectionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['started', 'joined']), runId: z.string() }).strict(),
  z.object({ status: z.literal('no_candidates') }).strict(),
]);
export type StartCuratedSelectionResult = z.infer<typeof StartCuratedSelectionResultSchema>;
export const SelectionComparisonSchema = z.object({ items: z.array(SelectionItemSchema) }).strict();
