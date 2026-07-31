/*
 * Workspace restore event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import {
  WorkspaceRestoreRequestedBySchema,
  WorkspaceRestoreResultStatusSchema,
  type WorkspaceRestoreRequestedBy,
  type WorkspaceRestoreResultStatus,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface WorkspaceRestoreRequestedPayload { restoreRequestId: string; changeSetId: string; requestedBy: WorkspaceRestoreRequestedBy }
export interface WorkspaceRestoreCompletedPayload {
  restoreRequestId: string; restoreResultId: string; changeSetId: string; status: WorkspaceRestoreResultStatus;
  changedFileCount: number; restoredCount: number; conflictCount: number; failedCount: number; noopCount: number;
}
export interface WorkspaceEventPayloads {
  'workspace.restore.requested': WorkspaceRestoreRequestedPayload;
  'workspace.restore.completed': WorkspaceRestoreCompletedPayload;
}
export type WorkspaceEventType = keyof WorkspaceEventPayloads;

const WorkspaceRestoreRequestedPayloadSchema = z.object({
  restoreRequestId: z.string().min(1), changeSetId: z.string().min(1), requestedBy: WorkspaceRestoreRequestedBySchema,
}).strict();
const WorkspaceRestoreCompletedPayloadSchema = z.object({
  restoreRequestId: z.string().min(1), restoreResultId: z.string().min(1), changeSetId: z.string().min(1), status: WorkspaceRestoreResultStatusSchema,
  changedFileCount: z.number().int().nonnegative(), restoredCount: z.number().int().nonnegative(), conflictCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(), noopCount: z.number().int().nonnegative(),
}).strict();

export const WorkspaceRestoreRequestedEventSchema = eventSchema('workspace.restore.requested', WorkspaceRestoreRequestedPayloadSchema);
export const WorkspaceRestoreCompletedEventSchema = eventSchema('workspace.restore.completed', WorkspaceRestoreCompletedPayloadSchema);
export const WORKSPACE_EVENT_SCHEMAS = {
  'workspace.restore.requested': WorkspaceRestoreRequestedEventSchema,
  'workspace.restore.completed': WorkspaceRestoreCompletedEventSchema,
} as const;

export function createWorkspaceEvent<TType extends WorkspaceEventType>(input: RunRuntimeEventFactoryInput<TType>): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
export function createWorkspaceRestoreRequestedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'workspace.restore.requested'>, 'eventType' | 'visibility' | 'persist'>,
): TypedRuntimeEvent<'workspace.restore.requested'> {
  return createRuntimeEvent({ ...input, eventType: 'workspace.restore.requested', visibility: 'system', persist: 'required' });
}
export function createWorkspaceRestoreCompletedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'workspace.restore.completed'>, 'eventType' | 'visibility' | 'persist'>,
): TypedRuntimeEvent<'workspace.restore.completed'> {
  return createRuntimeEvent({ ...input, eventType: 'workspace.restore.completed', visibility: 'system', persist: 'required' });
}
