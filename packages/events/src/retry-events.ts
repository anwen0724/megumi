/*
 * Run/action retry event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import {
  RetryKindSchema,
  RetryReasonSchema,
  RetryRequestedBySchema,
  type RetryKind,
  type RetryReason,
  type RetryRequestedBy,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-error';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface RunRetryRequestedPayload {
  retryRequestId: string;
  requestedBy: RetryRequestedBy;
  retryKind: RetryKind;
  reason: RetryReason;
  attemptNumber?: number;
  checkpointId?: string;
}
export interface RetryStartedPayload { retryRequestId: string; retryKind: RetryKind; checkpointId?: string }
export interface RetryCompletedPayload { retryRequestId: string; retryKind: RetryKind }
export interface RetryFailedPayload { retryRequestId: string; retryKind: RetryKind; error: RuntimeError }
export interface RetryEventPayloads {
  'run.retry.requested': RunRetryRequestedPayload;
  'action.retry.requested': RunRetryRequestedPayload;
  'retry.started': RetryStartedPayload;
  'retry.completed': RetryCompletedPayload;
  'retry.failed': RetryFailedPayload;
}
export type RetryEventType = keyof RetryEventPayloads;

const RunRetryRequestedPayloadSchema = z.object({
  retryRequestId: z.string().min(1), requestedBy: RetryRequestedBySchema, retryKind: RetryKindSchema,
  reason: RetryReasonSchema, attemptNumber: z.number().int().positive().optional(), checkpointId: z.string().min(1).optional(),
}).strict();
const RetryStartedPayloadSchema = z.object({
  retryRequestId: z.string().min(1), retryKind: RetryKindSchema, checkpointId: z.string().min(1).optional(),
}).strict();
const RetryCompletedPayloadSchema = z.object({ retryRequestId: z.string().min(1), retryKind: RetryKindSchema }).strict();
const RetryFailedPayloadSchema = z.object({ retryRequestId: z.string().min(1), retryKind: RetryKindSchema, error: RuntimeErrorSchema }).strict();

export const RunRetryRequestedEventSchema = eventSchema('run.retry.requested', RunRetryRequestedPayloadSchema);
export const ActionRetryRequestedEventSchema = eventSchema('action.retry.requested', RunRetryRequestedPayloadSchema);
export const RetryStartedEventSchema = eventSchema('retry.started', RetryStartedPayloadSchema);
export const RetryCompletedEventSchema = eventSchema('retry.completed', RetryCompletedPayloadSchema);
export const RetryFailedEventSchema = eventSchema('retry.failed', RetryFailedPayloadSchema);
export const RETRY_EVENT_SCHEMAS = {
  'run.retry.requested': RunRetryRequestedEventSchema,
  'action.retry.requested': ActionRetryRequestedEventSchema,
  'retry.started': RetryStartedEventSchema,
  'retry.completed': RetryCompletedEventSchema,
  'retry.failed': RetryFailedEventSchema,
} as const;

export function createRetryEvent<TType extends RetryEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> { return createRuntimeEvent(input); }
export function createRuntimeRunRetryRequestedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'run.retry.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RunRetryRequestedPayload,
): TypedRuntimeEvent<'run.retry.requested'> {
  return createRuntimeEvent({ ...input, eventType: 'run.retry.requested', visibility: 'system', persist: 'required', payload });
}
export function createRunRetryRequestedEvent(
  input: Omit<Parameters<typeof createRuntimeRunRetryRequestedEvent>[0], 'source'>,
  payload: RunRetryRequestedPayload,
): TypedRuntimeEvent<'run.retry.requested'> {
  return createRuntimeRunRetryRequestedEvent({ ...input, source: 'core' }, payload);
}
