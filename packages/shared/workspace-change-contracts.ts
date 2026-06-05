import { z } from 'zod';

import { JsonObjectSchema } from './json';
import { RuntimeErrorSchema } from './runtime-errors';
import { IsoDateTimeSchema, RuntimeIdSchema } from './runtime-validation';

export const WORKSPACE_CHANGE_KINDS = ['created', 'modified', 'deleted'] as const;
export const WORKSPACE_CHANGE_SET_STATUSES = ['open', 'finalized'] as const;
export const WORKSPACE_RESTORE_STATES = [
  'restorable',
  'restored',
  'conflict',
  'restore_failed',
  'not_restorable',
] as const;
export const WORKSPACE_RESTORE_REQUEST_STATUSES = ['requested', 'running', 'completed', 'failed'] as const;
export const WORKSPACE_RESTORE_RESULT_STATUSES = ['restored', 'partial', 'conflict', 'failed', 'noop'] as const;
export const WORKSPACE_RESTORE_FILE_RESULT_STATUSES = ['restored', 'conflict', 'failed', 'noop'] as const;
export const WORKSPACE_RESTORE_CONFLICT_REASONS = [
  'current_hash_mismatch',
  'current_file_missing',
  'current_file_exists',
  'path_outside_project',
  'snapshot_missing',
  'unsupported_file',
  'write_failed',
] as const;
export const WORKSPACE_RESTORE_REQUESTED_BY = ['user', 'host', 'system'] as const;
export const WORKSPACE_SNAPSHOT_CONTENT_STORAGES = ['sqlite_text'] as const;
export const WORKSPACE_SNAPSHOT_CONTENT_ENCODINGS = ['utf8'] as const;

export const WorkspaceChangeKindSchema = z.enum(WORKSPACE_CHANGE_KINDS);
export const WorkspaceChangeSetStatusSchema = z.enum(WORKSPACE_CHANGE_SET_STATUSES);
export const WorkspaceRestoreStateSchema = z.enum(WORKSPACE_RESTORE_STATES);
export const WorkspaceRestoreRequestStatusSchema = z.enum(WORKSPACE_RESTORE_REQUEST_STATUSES);
export const WorkspaceRestoreResultStatusSchema = z.enum(WORKSPACE_RESTORE_RESULT_STATUSES);
export const WorkspaceRestoreFileResultStatusSchema = z.enum(WORKSPACE_RESTORE_FILE_RESULT_STATUSES);
export const WorkspaceRestoreConflictReasonSchema = z.enum(WORKSPACE_RESTORE_CONFLICT_REASONS);
export const WorkspaceRestoreRequestedBySchema = z.enum(WORKSPACE_RESTORE_REQUESTED_BY);
export const WorkspaceSnapshotContentStorageSchema = z.enum(WORKSPACE_SNAPSHOT_CONTENT_STORAGES);
export const WorkspaceSnapshotContentEncodingSchema = z.enum(WORKSPACE_SNAPSHOT_CONTENT_ENCODINGS);

const WorkspaceProjectPathSchema = z.string().min(1).superRefine((value, context) => {
  if (value.includes('\\')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectPath must use forward slashes.',
    });
  }

  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectPath must be project-relative.',
    });
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectPath must not contain .. segments.',
    });
  }

  if (segments.some((segment) => segment === '' || segment === '.')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectPath must be normalized.',
    });
  }
});

const WorkspaceSha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, 'sha256 must be a 64-character hex string.');

const WorkspaceByteLengthSchema = z.number().int().nonnegative();
const WorkspaceIdSchema = RuntimeIdSchema;

const beforeStateShape = {
  beforeExists: z.boolean(),
  beforeContentRefId: WorkspaceIdSchema.optional(),
  beforeHash: WorkspaceSha256Schema.optional(),
  beforeByteLength: WorkspaceByteLengthSchema.optional(),
};

const afterStateShape = {
  afterExists: z.boolean(),
  afterContentRefId: WorkspaceIdSchema.optional(),
  afterHash: WorkspaceSha256Schema.optional(),
  afterByteLength: WorkspaceByteLengthSchema.optional(),
};

interface BeforeStateInput {
  beforeExists: boolean;
  beforeContentRefId?: string;
  beforeHash?: string;
  beforeByteLength?: number;
}

interface AfterStateInput {
  afterExists: boolean;
  afterContentRefId?: string;
  afterHash?: string;
  afterByteLength?: number;
}

function validateBeforeState(value: BeforeStateInput, context: z.RefinementCtx): void {
  if (value.beforeExists) {
    if (!value.beforeHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'beforeHash is required when beforeExists is true.',
        path: ['beforeHash'],
      });
    }
    if (value.beforeByteLength === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'beforeByteLength is required when beforeExists is true.',
        path: ['beforeByteLength'],
      });
    }
    return;
  }

  if (value.beforeContentRefId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'beforeContentRefId is not allowed when beforeExists is false.',
      path: ['beforeContentRefId'],
    });
  }
  if (value.beforeHash !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'beforeHash is not allowed when beforeExists is false.',
      path: ['beforeHash'],
    });
  }
  if (value.beforeByteLength !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'beforeByteLength is not allowed when beforeExists is false.',
      path: ['beforeByteLength'],
    });
  }
}

function validateAfterState(value: AfterStateInput, context: z.RefinementCtx): void {
  if (value.afterExists) {
    if (!value.afterHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'afterHash is required when afterExists is true.',
        path: ['afterHash'],
      });
    }
    if (value.afterByteLength === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'afterByteLength is required when afterExists is true.',
        path: ['afterByteLength'],
      });
    }
    return;
  }

  if (value.afterContentRefId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'afterContentRefId is not allowed when afterExists is false.',
      path: ['afterContentRefId'],
    });
  }
  if (value.afterHash !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'afterHash is not allowed when afterExists is false.',
      path: ['afterHash'],
    });
  }
  if (value.afterByteLength !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'afterByteLength is not allowed when afterExists is false.',
      path: ['afterByteLength'],
    });
  }
}

export const WorkspaceSnapshotContentSchema = z
  .object({
    contentRefId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    projectPath: WorkspaceProjectPathSchema,
    storage: WorkspaceSnapshotContentStorageSchema,
    encoding: WorkspaceSnapshotContentEncodingSchema,
    sha256: WorkspaceSha256Schema,
    byteLength: WorkspaceByteLengthSchema,
    contentText: z.string(),
    createdAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type WorkspaceSnapshotContent = z.infer<typeof WorkspaceSnapshotContentSchema>;

export const WorkspaceCheckpointSchema = z
  .object({
    workspaceCheckpointId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    stepId: WorkspaceIdSchema.optional(),
    toolCallId: WorkspaceIdSchema.optional(),
    toolExecutionId: WorkspaceIdSchema.optional(),
    sourceEntryId: WorkspaceIdSchema.optional(),
    responseMessageId: WorkspaceIdSchema.optional(),
    changeSetId: WorkspaceIdSchema.optional(),
    projectPath: WorkspaceProjectPathSchema,
    ...beforeStateShape,
    createdAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine(validateBeforeState);

export type WorkspaceCheckpoint = z.infer<typeof WorkspaceCheckpointSchema>;

export const WorkspaceChangedFileSchema = z
  .object({
    changedFileId: WorkspaceIdSchema,
    changeSetId: WorkspaceIdSchema,
    workspaceCheckpointId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    stepId: WorkspaceIdSchema.optional(),
    toolCallId: WorkspaceIdSchema.optional(),
    toolExecutionId: WorkspaceIdSchema.optional(),
    sourceEntryId: WorkspaceIdSchema.optional(),
    responseMessageId: WorkspaceIdSchema.optional(),
    projectPath: WorkspaceProjectPathSchema,
    changeKind: WorkspaceChangeKindSchema,
    restoreState: WorkspaceRestoreStateSchema,
    ...beforeStateShape,
    ...afterStateShape,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateBeforeState(value, context);
    validateAfterState(value, context);

    if (value.changeKind === 'created' && (value.beforeExists || !value.afterExists)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'created changes require beforeExists=false and afterExists=true.',
        path: ['changeKind'],
      });
    }

    if (value.changeKind === 'modified' && (!value.beforeExists || !value.afterExists)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'modified changes require beforeExists=true and afterExists=true.',
        path: ['changeKind'],
      });
    }

    if (value.changeKind === 'deleted' && (!value.beforeExists || value.afterExists)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'deleted changes require beforeExists=true and afterExists=false.',
        path: ['changeKind'],
      });
    }

    if (
      value.restoreState === 'restorable'
      && (value.changeKind === 'modified' || value.changeKind === 'deleted')
      && !value.beforeContentRefId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'restorable modified and deleted changes require beforeContentRefId.',
        path: ['beforeContentRefId'],
      });
    }
  });

export type WorkspaceChangedFile = z.infer<typeof WorkspaceChangedFileSchema>;

export const WorkspaceChangeSetSchema = z
  .object({
    changeSetId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    stepId: WorkspaceIdSchema.optional(),
    sourceEntryId: WorkspaceIdSchema.optional(),
    responseMessageId: WorkspaceIdSchema.optional(),
    status: WorkspaceChangeSetStatusSchema,
    changedFileCount: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    finalizedAt: IsoDateTimeSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'finalized' && !value.finalizedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'finalizedAt is required when status is finalized.',
        path: ['finalizedAt'],
      });
    }
  });

export type WorkspaceChangeSet = z.infer<typeof WorkspaceChangeSetSchema>;

export const WorkspaceRestoreRequestSchema = z
  .object({
    restoreRequestId: WorkspaceIdSchema,
    changeSetId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    requestedBy: WorkspaceRestoreRequestedBySchema,
    status: WorkspaceRestoreRequestStatusSchema,
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type WorkspaceRestoreRequest = z.infer<typeof WorkspaceRestoreRequestSchema>;

export const WorkspaceRestoreResultSchema = z
  .object({
    restoreResultId: WorkspaceIdSchema,
    restoreRequestId: WorkspaceIdSchema,
    changeSetId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    status: WorkspaceRestoreResultStatusSchema,
    restoredAt: IsoDateTimeSchema,
    error: RuntimeErrorSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'failed' && !value.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'error is required when status is failed.',
        path: ['error'],
      });
    }
  });

export type WorkspaceRestoreResult = z.infer<typeof WorkspaceRestoreResultSchema>;

export const WorkspaceRestoreFileResultSchema = z
  .object({
    restoreFileResultId: WorkspaceIdSchema,
    restoreResultId: WorkspaceIdSchema,
    changedFileId: WorkspaceIdSchema,
    projectPath: WorkspaceProjectPathSchema,
    status: WorkspaceRestoreFileResultStatusSchema,
    conflictReason: WorkspaceRestoreConflictReasonSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    restoredAt: IsoDateTimeSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'conflict' && !value.conflictReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflictReason is required when status is conflict.',
        path: ['conflictReason'],
      });
    }

    if (value.status === 'conflict' && value.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'error is not allowed when status is conflict.',
        path: ['error'],
      });
    }

    if (value.status === 'failed' && !value.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'error is required when status is failed.',
        path: ['error'],
      });
    }

    if (value.status === 'failed' && value.conflictReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflictReason is not allowed when status is failed.',
        path: ['conflictReason'],
      });
    }

    if ((value.status === 'restored' || value.status === 'noop') && value.conflictReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflictReason is not allowed when status is restored or noop.',
        path: ['conflictReason'],
      });
    }

    if ((value.status === 'restored' || value.status === 'noop') && value.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'error is not allowed when status is restored or noop.',
        path: ['error'],
      });
    }
  });

export type WorkspaceRestoreFileResult = z.infer<typeof WorkspaceRestoreFileResultSchema>;

export const WorkspaceChangeSummarySchema = z
  .object({
    changeSetId: WorkspaceIdSchema,
    sessionId: WorkspaceIdSchema,
    runId: WorkspaceIdSchema,
    changedFileCount: z.number().int().nonnegative(),
    restorableCount: z.number().int().nonnegative(),
    restoredCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    hasRestorableChanges: z.boolean(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type WorkspaceChangeSummary = z.infer<typeof WorkspaceChangeSummarySchema>;

export type WorkspaceChangeKind = z.infer<typeof WorkspaceChangeKindSchema>;
export type WorkspaceChangeSetStatus = z.infer<typeof WorkspaceChangeSetStatusSchema>;
export type WorkspaceRestoreState = z.infer<typeof WorkspaceRestoreStateSchema>;
export type WorkspaceRestoreRequestStatus = z.infer<typeof WorkspaceRestoreRequestStatusSchema>;
export type WorkspaceRestoreResultStatus = z.infer<typeof WorkspaceRestoreResultStatusSchema>;
export type WorkspaceRestoreFileResultStatus = z.infer<typeof WorkspaceRestoreFileResultStatusSchema>;
export type WorkspaceRestoreConflictReason = z.infer<typeof WorkspaceRestoreConflictReasonSchema>;
export type WorkspaceRestoreRequestedBy = z.infer<typeof WorkspaceRestoreRequestedBySchema>;
export type WorkspaceSnapshotContentStorage = z.infer<typeof WorkspaceSnapshotContentStorageSchema>;
export type WorkspaceSnapshotContentEncoding = z.infer<typeof WorkspaceSnapshotContentEncodingSchema>;
