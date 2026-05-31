import { z } from 'zod';

import { ModelInputContextSourceRefSchema } from './model-input-context-contracts';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const NonEmptyTextSchema = z.string().min(1);

export const SESSION_COMPACTION_TRIGGER_REASONS = [
  'context_budget_pressure',
] as const;
export type SessionCompactionTriggerReason =
  (typeof SESSION_COMPACTION_TRIGGER_REASONS)[number];

export const SESSION_COMPACTION_STATUSES = ['completed'] as const;
export type SessionCompactionStatus = (typeof SESSION_COMPACTION_STATUSES)[number];

export const SessionCompactionMetadataSchema = z
  .object({
    previousCompactionId: IdSchema.optional(),
    summarizedSourceCount: z.number().int().nonnegative().optional(),
    readFiles: z.array(NonEmptyTextSchema).optional(),
    modifiedFiles: z.array(NonEmptyTextSchema).optional(),
  })
  .strict();

export type SessionCompactionMetadata = z.infer<
  typeof SessionCompactionMetadataSchema
>;

export const SessionCompactionEntrySchema = z
  .object({
    compactionId: IdSchema,
    sessionId: IdSchema,
    summary: NonEmptyTextSchema,
    summaryKind: z.literal('compaction'),
    firstKeptSourceRef: ModelInputContextSourceRefSchema,
    tokensBefore: z.number().int().nonnegative(),
    triggerReason: z.enum(SESSION_COMPACTION_TRIGGER_REASONS),
    status: z.enum(SESSION_COMPACTION_STATUSES),
    createdAt: IsoDateTimeSchema,
    metadata: SessionCompactionMetadataSchema.optional(),
  })
  .strict();

export type SessionCompactionEntry = z.infer<
  typeof SessionCompactionEntrySchema
>;
