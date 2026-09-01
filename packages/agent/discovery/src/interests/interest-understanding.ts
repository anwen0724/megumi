/*
 * Defines the durable receipt and completion fact for one post-conversation
 * Interest Understanding operation.
 */
import { z } from 'zod';

const TimestampSchema = z.string().datetime({ offset: true });
const BaseSchema = z.object({
  interestUnderstandingId: z.string().min(1),
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  userMessageId: z.string().min(1),
  assistantMessageId: z.string().min(1),
  queuedAt: TimestampSchema,
}).strict();

export const InterestUnderstandingSchema = z.discriminatedUnion('status', [
  BaseSchema.extend({ status: z.literal('queued') }).strict(),
  BaseSchema.extend({ status: z.literal('running'), startedAt: TimestampSchema }).strict(),
  BaseSchema.extend({
    status: z.literal('completed'),
    outcome: z.enum(['evidence_committed', 'no_durable_evidence']),
    changedInterestIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
  }).strict(),
  BaseSchema.extend({
    status: z.enum(['failed', 'interrupted']),
    failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
    startedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema,
  }).strict(),
]);

export type InterestUnderstanding = z.infer<typeof InterestUnderstandingSchema>;

export interface InterestUnderstandingReceipt {
  readonly interestUnderstandingId: string;
  readonly executionId: string;
  readonly status: 'queued';
  readonly queuedAt: string;
}

export function isInterestUnderstandingTerminal(value: InterestUnderstanding): boolean {
  return value.status === 'completed' || value.status === 'failed' || value.status === 'interrupted';
}
