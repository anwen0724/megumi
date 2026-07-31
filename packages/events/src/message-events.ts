/*
 * Message stream event payloads, schemas, and factory.
 */
import { z } from 'zod';
import { SessionMessageStatusSchema, type SessionMessageStatus } from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface MessageDeltaPayload { messageId: string; delta: string }
export interface MessageCompletedPayload { messageId: string; status: SessionMessageStatus }
export interface MessageEventPayloads {
  'message.delta': MessageDeltaPayload;
  'message.completed': MessageCompletedPayload;
}
export type MessageEventType = keyof MessageEventPayloads;

const MessageDeltaPayloadSchema = z.object({ messageId: z.string().min(1), delta: z.string() }).strict();
const MessageCompletedPayloadSchema = z.object({
  messageId: z.string().min(1),
  status: SessionMessageStatusSchema,
}).strict();

export const MessageDeltaEventSchema = eventSchema('message.delta', MessageDeltaPayloadSchema);
export const MessageCompletedEventSchema = eventSchema('message.completed', MessageCompletedPayloadSchema);
export const MESSAGE_EVENT_SCHEMAS = {
  'message.delta': MessageDeltaEventSchema,
  'message.completed': MessageCompletedEventSchema,
} as const;

export function createMessageEvent<TType extends MessageEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
