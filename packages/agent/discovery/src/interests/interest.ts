/*
 * Defines durable Interest, Evidence, and Session participation contracts.
 */
import { z } from 'zod';

const TimestampSchema = z.string().datetime({ offset: true });
export const InterestDescriptionSchema = z.string().trim().min(1).max(1000);
export const InterestStatusSchema = z.enum(['active', 'paused', 'deleted']);
export const InterestCreatedFromSchema = z.enum(['manual', 'conversation']);

export const InterestSchema = z.object({
  interestId: z.string().min(1),
  description: InterestDescriptionSchema,
  status: InterestStatusSchema,
  createdFrom: InterestCreatedFromSchema,
  revision: z.number().int().nonnegative(),
  userManagedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  pausedAt: TimestampSchema.optional(),
  deletedAt: TimestampSchema.optional(),
}).strict();

export const InterestEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  interestId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  description: InterestDescriptionSchema,
  effect: z.enum(['support', 'reject']),
  confidence: z.enum(['high', 'medium']),
  status: z.enum(['pending', 'applied', 'retracted']),
  createdAt: TimestampSchema,
  appliedAt: TimestampSchema.optional(),
  retractedAt: TimestampSchema.optional(),
}).strict();

export const SessionParticipationSchema = z.object({
  sessionId: z.string().min(1),
  participation: z.enum(['included', 'excluded']),
  effectiveFrom: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const InterestExtractionResultSchema = z.object({
  evidence: z.array(z.object({
    description: InterestDescriptionSchema,
    effect: z.enum(['support', 'reject']),
    confidence: z.enum(['high', 'medium', 'low']),
    matchedInterestId: z.string().min(1).optional(),
    supportingEvidenceIds: z.array(z.string().min(1)).optional(),
  }).strict()),
}).strict();

export type Interest = z.infer<typeof InterestSchema>;
export type InterestEvidence = z.infer<typeof InterestEvidenceSchema>;
export type SessionParticipation = z.infer<typeof SessionParticipationSchema>;
export type InterestExtractionResult = z.infer<typeof InterestExtractionResultSchema>;

export type ChangeInterestRequest =
  | { readonly action: 'create'; readonly description: string }
  | { readonly action: 'update'; readonly interestId: string; readonly description: string }
  | { readonly action: 'pause'; readonly interestId: string }
  | { readonly action: 'resume'; readonly interestId: string }
  | { readonly action: 'delete'; readonly interestId: string };

export interface SetSessionParticipationRequest {
  readonly sessionId: string;
  readonly participation: 'included' | 'excluded';
}
