/*
 * Checkpoint lifecycle event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import {
  CheckpointBoundarySchema,
  CheckpointReasonSchema,
  ResumeReasonSchema,
  type CheckpointBoundary,
  type CheckpointReason,
  type ResumeReason,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface CheckpointCreatedPayload {
  checkpointId: string;
  reason: CheckpointReason;
  boundary: CheckpointBoundary;
  stateSummary: string;
}
export interface CheckpointRestoredPayload { checkpointId: string; resumeRequestId?: string; reason: ResumeReason }
export interface CheckpointInvalidatedPayload { checkpointId: string; reason: string }
export interface CheckpointDiscardedPayload { checkpointId: string; reason: string }
export interface CheckpointEventPayloads {
  'checkpoint.created': CheckpointCreatedPayload;
  'checkpoint.restored': CheckpointRestoredPayload;
  'checkpoint.invalidated': CheckpointInvalidatedPayload;
  'checkpoint.discarded': CheckpointDiscardedPayload;
}
export type CheckpointEventType = keyof CheckpointEventPayloads;

const CheckpointCreatedPayloadSchema = z.object({
  checkpointId: z.string().min(1), reason: CheckpointReasonSchema, boundary: CheckpointBoundarySchema, stateSummary: z.string().min(1),
}).strict();
const CheckpointRestoredPayloadSchema = z.object({
  checkpointId: z.string().min(1), resumeRequestId: z.string().min(1).optional(), reason: ResumeReasonSchema,
}).strict();
const CheckpointStatusChangePayloadSchema = z.object({ checkpointId: z.string().min(1), reason: z.string().min(1) }).strict();

export const CheckpointCreatedEventSchema = eventSchema('checkpoint.created', CheckpointCreatedPayloadSchema);
export const CheckpointRestoredEventSchema = eventSchema('checkpoint.restored', CheckpointRestoredPayloadSchema);
export const CheckpointInvalidatedEventSchema = eventSchema('checkpoint.invalidated', CheckpointStatusChangePayloadSchema);
export const CheckpointDiscardedEventSchema = eventSchema('checkpoint.discarded', CheckpointStatusChangePayloadSchema);
export const CHECKPOINT_EVENT_SCHEMAS = {
  'checkpoint.created': CheckpointCreatedEventSchema,
  'checkpoint.restored': CheckpointRestoredEventSchema,
  'checkpoint.invalidated': CheckpointInvalidatedEventSchema,
  'checkpoint.discarded': CheckpointDiscardedEventSchema,
} as const;

export function createCheckpointEvent<TType extends CheckpointEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> { return createRuntimeEvent(input); }
export function createRuntimeCheckpointCreatedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'checkpoint.created'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: CheckpointCreatedPayload,
): TypedRuntimeEvent<'checkpoint.created'> {
  return createRuntimeEvent({ ...input, eventType: 'checkpoint.created', visibility: 'system', persist: 'required', payload });
}
export function createCheckpointCreatedEvent(
  input: Omit<Parameters<typeof createRuntimeCheckpointCreatedEvent>[0], 'source'>,
  payload: CheckpointCreatedPayload,
): TypedRuntimeEvent<'checkpoint.created'> {
  return createRuntimeCheckpointCreatedEvent({ ...input, source: 'core' }, payload);
}
