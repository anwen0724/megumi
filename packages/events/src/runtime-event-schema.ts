/*
 * Unified runtime event schema aggregation and validation entry points.
 */
import { z } from 'zod';
import { ACTION_EVENT_SCHEMAS } from './action-events';
import { APPROVAL_EVENT_SCHEMAS } from './approval-events';
import { CHECKPOINT_EVENT_SCHEMAS } from './checkpoint-events';
import { CONTEXT_EVENT_SCHEMAS } from './context-events';
import { ERROR_EVENT_SCHEMAS } from './error-events';
import { MESSAGE_EVENT_SCHEMAS } from './message-events';
import { MODEL_EVENT_SCHEMAS } from './model-events';
import { OBSERVATION_EVENT_SCHEMAS } from './observation-events';
import { RETRY_EVENT_SCHEMAS } from './retry-events';
import { RUN_EVENT_SCHEMAS } from './run-events';
import { SESSION_EVENT_SCHEMAS } from './session-events';
import { TOOL_EVENT_SCHEMAS } from './tool-events';
import { WORKSPACE_EVENT_SCHEMAS } from './workspace-events';
import {
  RUNTIME_EVENT_ENVELOPE_TYPES,
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
  type RuntimeEventEnvelopeType,
  type RuntimeEventPayloadByType,
  type RuntimeEventType,
} from './runtime-event';
import {
  RuntimeEventIdSchema,
  RuntimeEventIsoDateTimeSchema,
  RuntimeEventPersistModeSchema,
  RuntimeEventSequenceSchema,
  RuntimeEventSourceSchema,
  RuntimeEventVisibilitySchema,
} from './internal/event-schema-helpers';

export const RuntimeEventTypeSchema = z.enum(RUNTIME_EVENT_TYPES);
export const RuntimeEventEnvelopeTypeSchema = z.enum(RUNTIME_EVENT_ENVELOPE_TYPES);

export const RUNTIME_EVENT_SCHEMAS_BY_TYPE = {
  ...SESSION_EVENT_SCHEMAS,
  ...RUN_EVENT_SCHEMAS,
  ...ACTION_EVENT_SCHEMAS,
  ...OBSERVATION_EVENT_SCHEMAS,
  ...CONTEXT_EVENT_SCHEMAS,
  ...MESSAGE_EVENT_SCHEMAS,
  ...ERROR_EVENT_SCHEMAS,
  ...MODEL_EVENT_SCHEMAS,
  ...TOOL_EVENT_SCHEMAS,
  ...APPROVAL_EVENT_SCHEMAS,
  ...CHECKPOINT_EVENT_SCHEMAS,
  ...RETRY_EVENT_SCHEMAS,
  ...WORKSPACE_EVENT_SCHEMAS,
} satisfies Record<RuntimeEventEnvelopeType, z.ZodTypeAny>;

const runtimeEventSchemaOptions = Object.values(RUNTIME_EVENT_SCHEMAS_BY_TYPE) as unknown as [
  z.ZodDiscriminatedUnionOption<'eventType'>,
  ...z.ZodDiscriminatedUnionOption<'eventType'>[],
];

export const RuntimeEventSchema = z.discriminatedUnion('eventType', runtimeEventSchemaOptions);

export function validateRuntimeEvent(value: unknown): RuntimeEvent {
  return RuntimeEventSchema.parse(value) as RuntimeEvent;
}

export function safeValidateRuntimeEvent(value: unknown) {
  return RuntimeEventSchema.safeParse(value);
}

export function createRuntimeEventSchema<
  TType extends RuntimeEventEnvelopeType,
  TPayload extends RuntimeEventPayloadByType[TType],
>(eventType: TType, payload: TPayload): Pick<RuntimeEvent<TPayload>, 'eventType' | 'payload'> {
  return { eventType, payload };
}

export type RuntimeEventFromSchema = z.infer<typeof RuntimeEventSchema>;

export {
  RuntimeEventIdSchema,
  RuntimeEventIsoDateTimeSchema,
  RuntimeEventPersistModeSchema,
  RuntimeEventSequenceSchema,
  RuntimeEventSourceSchema,
  RuntimeEventVisibilitySchema,
};
export { isTerminalRuntimeEvent } from './runtime-event';
export type { RuntimeEventType };
