/*
 * Defines the user-managed interest contract for Candidate Supply. The
 * `interests` table is the only owner of interest state; storage code keeps the
 * original text and monotonic revision. Derived data belongs to its consumers.
 */
import { z } from 'zod';

/** Stable interest identifier. Editing the description keeps the same id. */
export const InterestIdSchema = z.string().trim().min(1);

export type InterestId = z.infer<typeof InterestIdSchema>;

/** User-written interest description, stored without surrounding whitespace. */
export const InterestTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(text => [...text].length <= 1_000, 'Interest text must not exceed 1000 code points.');

export type InterestText = z.infer<typeof InterestTextSchema>;

export const InterestSchema = z
  .object({
    id: InterestIdSchema,
    text: InterestTextSchema,
    enabled: z.boolean(),
    revision: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type Interest = z.infer<typeof InterestSchema>;

/** One interest as it was actually saved when a caller read the snapshot. */
export const InterestSnapshotEntrySchema = z
  .object({
    id: InterestIdSchema,
    text: InterestTextSchema,
    enabled: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();

export type InterestSnapshotEntry = z.infer<typeof InterestSnapshotEntrySchema>;

/**
 * Interests available for one maintenance run or one preparation request.
 * Candidates must reference at least one enabled interest in this snapshot.
 */
export const InterestSnapshotSchema = z
  .object({ interests: z.array(InterestSnapshotEntrySchema) })
  .strict();

export type InterestSnapshot = z.infer<typeof InterestSnapshotSchema>;

export const CreateInterestRequestSchema = z.object({ text: InterestTextSchema }).strict();

export type CreateInterestRequest = z.infer<typeof CreateInterestRequestSchema>;

const UpdateInterestRequestShape = {
  interestId: InterestIdSchema,
  expectedRevision: z.number().int().positive(),
  text: InterestTextSchema.optional(),
  enabled: z.boolean().optional(),
};

/** At least one of `text` and `enabled` must be present. */
export const UpdateInterestRequestSchema = z
  .object(UpdateInterestRequestShape)
  .strict()
  .refine(value => value.text !== undefined || value.enabled !== undefined, {
    message: 'Provide text, enabled, or both.',
  });

export type UpdateInterestRequest = z.infer<typeof UpdateInterestRequestSchema>;

export const DeleteInterestRequestSchema = z
  .object({
    interestId: InterestIdSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export type DeleteInterestRequest = z.infer<typeof DeleteInterestRequestSchema>;

export type CreateInterestResult =
  | {
      status: 'created';
      interest: Interest;
    }
  | {
      status: 'invalid_request';
      message: string;
    };

export type UpdateInterestResult =
  | {
      status: 'updated';
      interest: Interest;
    }
  | {
      status: 'unchanged';
      interest: Interest;
    }
  | { status: 'revision_conflict' }
  | { status: 'not_found' }
  | {
      status: 'invalid_request';
      message: string;
    };

export type DeleteInterestResult =
  | { status: 'deleted' }
  | { status: 'already_deleted' }
  | { status: 'revision_conflict' }
  | {
      status: 'invalid_request';
      message: string;
    };

/**
 * Interest management surface. Saving an interest never searches, calls a
 * model, or deletes content; maintenance reacts to saved state.
 */
export interface InterestManagement {
  listInterests(): Promise<InterestSnapshot>;
  createInterest(request: CreateInterestRequest): Promise<CreateInterestResult>;
  updateInterest(request: UpdateInterestRequest): Promise<UpdateInterestResult>;
  deleteInterest(request: DeleteInterestRequest): Promise<DeleteInterestResult>;
}
