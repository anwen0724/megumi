import { z } from 'zod';

import {
  ModelInputContextSourceRefSchema,
  type ModelInputContextSourceRef,
} from '../model/input-context-contracts';
import { JsonObjectSchema, type JsonObject } from '../primitives/json';
import { RuntimeErrorSchema, type RuntimeError } from '../runtime/errors';
import { IsoDateTimeSchema } from '../runtime/validation';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const SESSION_ACTIVE_LEAF_REASONS = [
  'session_created',
  'source_appended',
  'branch_marker',
  'branch_cancelled',
  'manual_repair',
] as const;
export type SessionActiveLeafReason = (typeof SESSION_ACTIVE_LEAF_REASONS)[number];

export const SESSION_BRANCH_MARKER_REASONS = [
  'branch_from_user_message',
  'branch_cancelled',
] as const;
export type SessionBranchMarkerReason = (typeof SESSION_BRANCH_MARKER_REASONS)[number];

export const SESSION_RETRY_KINDS = [
  'automatic_model_step',
  'manual_retry',
  'manual_rerun',
] as const;
export type SessionRetryKind = (typeof SESSION_RETRY_KINDS)[number];

export const SESSION_RETRY_REASONS = [
  'provider_overload',
  'rate_limited',
  'service_unavailable',
  'network_timeout',
  'premature_stream_end',
  'runtime_provider_error',
  'user_requested',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type SessionRetryReason = (typeof SESSION_RETRY_REASONS)[number];

export const SESSION_RETRY_ATTEMPT_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'exhausted',
] as const;
export type SessionRetryAttemptStatus = (typeof SESSION_RETRY_ATTEMPT_STATUSES)[number];

export const SESSION_INTERRUPTED_RUN_REASONS = [
  'app_restarted',
  'host_shutdown',
  'runtime_lost',
] as const;
export type SessionInterruptedRunReason = (typeof SESSION_INTERRUPTED_RUN_REASONS)[number];

export const SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES = [
  'queued',
  'running',
  'cancelling',
] as const;
export type SessionInterruptedRunPreviousStatus = (typeof SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES)[number];

export const SessionSourceEntrySchema = z
  .object({
    sourceEntryId: IdSchema,
    sessionId: IdSchema,
    parentSourceEntryId: IdSchema.optional(),
    sourceRef: ModelInputContextSourceRefSchema,
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionSourceEntry {
  sourceEntryId: string;
  sessionId: string;
  parentSourceEntryId?: string;
  sourceRef: ModelInputContextSourceRef;
  createdAt: string;
  metadata?: JsonObject;
}

export const SessionActiveLeafSchema = z
  .object({
    sessionId: IdSchema,
    leafSourceEntryId: IdSchema.nullable().optional(),
    updatedAt: IsoDateTimeSchema,
    reason: z.enum(SESSION_ACTIVE_LEAF_REASONS),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionActiveLeaf {
  sessionId: string;
  leafSourceEntryId?: string | null;
  updatedAt: string;
  reason: SessionActiveLeafReason;
  metadata?: JsonObject;
}

export const SessionActivePathSchema = z
  .object({
    sessionId: IdSchema,
    leafSourceEntryId: IdSchema.optional(),
    entries: z.array(SessionSourceEntrySchema),
  })
  .strict()
  .superRefine((path, context) => {
    for (const [index, entry] of path.entries.entries()) {
      if (entry.sessionId !== path.sessionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Active path entries must belong to the active path session.',
          path: ['entries', index, 'sessionId'],
        });
      }
    }

    if (path.leafSourceEntryId === undefined) {
      return;
    }

    const lastEntry = path.entries[path.entries.length - 1];
    const leafEntry = path.entries.find((entry) => entry.sourceEntryId === path.leafSourceEntryId);

    if (!leafEntry) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active path leafSourceEntryId must be present in entries.',
        path: ['leafSourceEntryId'],
      });
      return;
    }

    if (lastEntry?.sourceEntryId !== path.leafSourceEntryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active path leafSourceEntryId must reference the final entry.',
        path: ['leafSourceEntryId'],
      });
    }
  });

export interface SessionActivePath {
  sessionId: string;
  leafSourceEntryId?: string;
  entries: SessionSourceEntry[];
}

export const SessionBranchMarkerSchema = z
  .object({
    branchMarkerId: IdSchema,
    sessionId: IdSchema,
    previousLeafSourceEntryId: IdSchema.optional(),
    targetLeafSourceEntryId: IdSchema.optional(),
    selectedSourceRef: ModelInputContextSourceRefSchema,
    seedSourceRef: ModelInputContextSourceRefSchema.optional(),
    reason: z.enum(SESSION_BRANCH_MARKER_REASONS),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionBranchMarker {
  branchMarkerId: string;
  sessionId: string;
  previousLeafSourceEntryId?: string;
  targetLeafSourceEntryId?: string;
  selectedSourceRef: ModelInputContextSourceRef;
  seedSourceRef?: ModelInputContextSourceRef;
  reason: SessionBranchMarkerReason;
  createdAt: string;
  metadata?: JsonObject;
}

export const SessionRetryAttemptSchema = z
  .object({
    retryAttemptId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema,
    baseRunId: IdSchema.optional(),
    baseSourceEntryId: IdSchema.optional(),
    attemptNumber: z.number().int().positive(),
    retryKind: z.enum(SESSION_RETRY_KINDS),
    reason: z.enum(SESSION_RETRY_REASONS),
    status: z.enum(SESSION_RETRY_ATTEMPT_STATUSES),
    retryable: z.boolean(),
    createdAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionRetryAttempt {
  retryAttemptId: string;
  sessionId: string;
  runId: string;
  baseRunId?: string;
  baseSourceEntryId?: string;
  attemptNumber: number;
  retryKind: SessionRetryKind;
  reason: SessionRetryReason;
  status: SessionRetryAttemptStatus;
  retryable: boolean;
  createdAt: string;
  completedAt?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const SessionInterruptedRunMarkerSchema = z
  .object({
    interruptedMarkerId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema,
    previousStatus: z.enum(SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES),
    reason: z.enum(SESSION_INTERRUPTED_RUN_REASONS),
    markedAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionInterruptedRunMarker {
  interruptedMarkerId: string;
  sessionId: string;
  runId: string;
  previousStatus: SessionInterruptedRunPreviousStatus;
  reason: SessionInterruptedRunReason;
  markedAt: string;
  metadata?: JsonObject;
}

