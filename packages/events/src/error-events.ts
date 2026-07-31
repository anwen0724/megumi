/*
 * Runtime error event payload, schema, and factory.
 */
import { z } from 'zod';
import { eventSchema } from './internal/event-schema-helpers';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-error';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface ErrorRaisedPayload { error: RuntimeError }
export interface ErrorEventPayloads { 'error.raised': ErrorRaisedPayload }

const ErrorRaisedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();
export const ErrorRaisedEventSchema = eventSchema('error.raised', ErrorRaisedPayloadSchema);
export const ERROR_EVENT_SCHEMAS = { 'error.raised': ErrorRaisedEventSchema } as const;

export function createErrorEvent(
  input: RunRuntimeEventFactoryInput<'error.raised'>,
): TypedRuntimeEvent<'error.raised'> {
  return createRuntimeEvent(input);
}
