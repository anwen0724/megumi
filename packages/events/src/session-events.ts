/*
 * Session event payloads, runtime schemas, and creation functions.
 */
import { z } from 'zod';
import {
  ModelInputContextSourceRefSchema,
  SESSION_ACTIVE_LEAF_REASONS,
  SESSION_BRANCH_MARKER_REASONS,
  SessionStatusSchema,
  type ModelInputContextSourceRef,
  type SessionActiveLeafReason,
  type SessionBranchMarkerReason,
  type SessionStatus,
} from './internal/runtime-event-dependencies';
import { sessionScopedEventSchema, unscopedEventSchema } from './internal/event-schema-helpers';
import {
  createSessionScopedRuntimeEvent,
  createUnscopedRuntimeEvent,
  type SessionScopedRuntimeEventFactoryInput,
  type UnscopedRuntimeEventFactoryInput,
} from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface SessionCreatedPayload { title: string; status: SessionStatus }
export interface SessionUpdatedPayload { changedFields: string[] }
export interface SessionActiveLeafChangedPayload {
  previousLeafSourceEntryId?: string;
  leafSourceEntryId?: string;
  reason: SessionActiveLeafReason;
  sourceRef?: ModelInputContextSourceRef;
}
export interface SessionBranchMarkerCreatedPayload {
  branchMarkerId: string;
  branchMarkerSourceEntryId: string;
  previousLeafSourceEntryId?: string;
  targetLeafSourceEntryId?: string;
  selectedSourceRef: ModelInputContextSourceRef;
  seedSourceRef?: ModelInputContextSourceRef;
  reason: SessionBranchMarkerReason;
}
export interface SessionBranchDraftCancelledPayload {
  branchMarkerId: string;
  branchMarkerSourceEntryId: string;
  restoredLeafSourceEntryId?: string;
  reason: 'branch_cancelled';
}

export interface SessionEventPayloads {
  'session.created': SessionCreatedPayload;
  'session.updated': SessionUpdatedPayload;
  'session.active_leaf.changed': SessionActiveLeafChangedPayload;
  'session.branch_marker.created': SessionBranchMarkerCreatedPayload;
  'session.branch_draft.cancelled': SessionBranchDraftCancelledPayload;
}
export type SessionEventType = keyof SessionEventPayloads;

const SessionCreatedPayloadSchema = z.object({
  title: z.string().min(1),
  status: SessionStatusSchema,
}).strict();
const SessionUpdatedPayloadSchema = z.object({ changedFields: z.array(z.string().min(1)).min(1) }).strict();
const SessionActiveLeafChangedPayloadSchema = z.object({
  previousLeafSourceEntryId: z.string().min(1).optional(),
  leafSourceEntryId: z.string().min(1).optional(),
  reason: z.enum(SESSION_ACTIVE_LEAF_REASONS),
  sourceRef: ModelInputContextSourceRefSchema.optional(),
}).strict();
const SessionBranchMarkerCreatedPayloadSchema = z.object({
  branchMarkerId: z.string().min(1),
  branchMarkerSourceEntryId: z.string().min(1),
  previousLeafSourceEntryId: z.string().min(1).optional(),
  targetLeafSourceEntryId: z.string().min(1).optional(),
  selectedSourceRef: ModelInputContextSourceRefSchema,
  seedSourceRef: ModelInputContextSourceRefSchema.optional(),
  reason: z.enum(SESSION_BRANCH_MARKER_REASONS),
}).strict();
const SessionBranchDraftCancelledPayloadSchema = z.object({
  branchMarkerId: z.string().min(1),
  branchMarkerSourceEntryId: z.string().min(1),
  restoredLeafSourceEntryId: z.string().min(1).optional(),
  reason: z.literal('branch_cancelled'),
}).strict();

export const SessionCreatedEventSchema = unscopedEventSchema('session.created', SessionCreatedPayloadSchema);
export const SessionUpdatedEventSchema = unscopedEventSchema('session.updated', SessionUpdatedPayloadSchema);
export const SessionActiveLeafChangedEventSchema = sessionScopedEventSchema(
  'session.active_leaf.changed',
  SessionActiveLeafChangedPayloadSchema,
);
export const SessionBranchMarkerCreatedEventSchema = sessionScopedEventSchema(
  'session.branch_marker.created',
  SessionBranchMarkerCreatedPayloadSchema,
);
export const SessionBranchDraftCancelledEventSchema = sessionScopedEventSchema(
  'session.branch_draft.cancelled',
  SessionBranchDraftCancelledPayloadSchema,
);

export const SESSION_EVENT_SCHEMAS = {
  'session.created': SessionCreatedEventSchema,
  'session.updated': SessionUpdatedEventSchema,
  'session.active_leaf.changed': SessionActiveLeafChangedEventSchema,
  'session.branch_marker.created': SessionBranchMarkerCreatedEventSchema,
  'session.branch_draft.cancelled': SessionBranchDraftCancelledEventSchema,
} as const;

export function createSessionEvent<TType extends SessionEventType>(
  input: UnscopedRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createUnscopedRuntimeEvent(input);
}

type ActivePathInput<TType extends Exclude<SessionEventType, 'session.created' | 'session.updated'>> = Omit<
  SessionScopedRuntimeEventFactoryInput<TType>,
  'eventType' | 'source' | 'visibility' | 'persist'
>;

export function createSessionActiveLeafChangedEvent(
  input: ActivePathInput<'session.active_leaf.changed'>,
): TypedRuntimeEvent<'session.active_leaf.changed'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.active_leaf.changed',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createSessionBranchMarkerCreatedEvent(
  input: ActivePathInput<'session.branch_marker.created'>,
): TypedRuntimeEvent<'session.branch_marker.created'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.branch_marker.created',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createSessionBranchDraftCancelledEvent(
  input: ActivePathInput<'session.branch_draft.cancelled'>,
): TypedRuntimeEvent<'session.branch_draft.cancelled'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.branch_draft.cancelled',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}
