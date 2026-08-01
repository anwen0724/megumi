/*
 * Host-maintenance action event payloads, schemas, and factories.
 */
import { z } from 'zod';
import { JsonObjectSchema, type JsonValue } from '@megumi/ai';
import {
  CancelReasonSchema,
  RunActionKindSchema,
  RunActionStatusSchema,
  type CancelReason,
  type RunActionKind,
  type RunActionStatus,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface ActionRequestedPayload {
  kind: RunActionKind;
  status: RunActionStatus;
  inputPreview?: Record<string, JsonValue>;
}
export interface ActionCancelledPayload { cancelRequestId: string; reason?: CancelReason }

export interface ActionEventPayloads {
  'action.requested': ActionRequestedPayload;
  'action.cancelled': ActionCancelledPayload;
}
export type ActionEventType = keyof ActionEventPayloads;

const ActionRequestedPayloadSchema = z.object({
  kind: RunActionKindSchema,
  status: RunActionStatusSchema,
  inputPreview: JsonObjectSchema.optional(),
}).strict();
const ActionCancelledPayloadSchema = z.object({
  cancelRequestId: z.string().min(1),
  reason: CancelReasonSchema.optional(),
}).strict();

export const ActionRequestedEventSchema = eventSchema('action.requested', ActionRequestedPayloadSchema);
export const ActionCancelledEventSchema = eventSchema('action.cancelled', ActionCancelledPayloadSchema);

export const ACTION_EVENT_SCHEMAS = {
  'action.requested': ActionRequestedEventSchema,
  'action.cancelled': ActionCancelledEventSchema,
} as const;

export function createActionEvent<TType extends ActionEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
