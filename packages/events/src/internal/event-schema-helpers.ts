/*
 * Internal envelope schema builders used by vertically owned event families.
 */
import { z } from 'zod';
import { RuntimeContextSchema } from '../runtime-error';
import {
  RUNTIME_EVENT_PERSIST_MODES,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_EVENT_SOURCES,
  RUNTIME_EVENT_VISIBILITIES,
  type RuntimeEventEnvelopeType,
} from '../runtime-event';

export const RuntimeEventSourceSchema = z.enum(RUNTIME_EVENT_SOURCES);
export const RuntimeEventVisibilitySchema = z.enum(RUNTIME_EVENT_VISIBILITIES);
export const RuntimeEventPersistModeSchema = z.enum(RUNTIME_EVENT_PERSIST_MODES);

export const RuntimeEventIdSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z0-9:_-]+$/,
  'Event id must contain only letters, numbers, colon, underscore, or hyphen.',
);
export const RuntimeEventSequenceSchema = z.number().int().positive();
export const RuntimeEventIsoDateTimeSchema = z.string().datetime({ offset: true });

export const RuntimeEventBaseSchema = z.object({
  eventId: RuntimeEventIdSchema,
  schemaVersion: z.literal(RUNTIME_EVENT_SCHEMA_VERSION),
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  observationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  context: RuntimeContextSchema.optional(),
  sequence: RuntimeEventSequenceSchema,
  createdAt: RuntimeEventIsoDateTimeSchema,
  source: RuntimeEventSourceSchema,
  visibility: RuntimeEventVisibilitySchema,
  persist: RuntimeEventPersistModeSchema,
}).strict();

const RunScopedRuntimeEventBaseSchema = RuntimeEventBaseSchema.extend({
  runId: z.string().min(1),
}).strict();

const SessionScopedRuntimeEventBaseSchema = RuntimeEventBaseSchema.extend({
  sessionId: z.string().min(1),
  runId: z.undefined().optional(),
}).strict();

export function eventSchema<TType extends RuntimeEventEnvelopeType, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return RunScopedRuntimeEventBaseSchema.extend({ eventType: z.literal(eventType), payload }).strict();
}

export function unscopedEventSchema<
  TType extends RuntimeEventEnvelopeType,
  TPayloadSchema extends z.ZodTypeAny,
>(eventType: TType, payload: TPayloadSchema) {
  return RuntimeEventBaseSchema.extend({ eventType: z.literal(eventType), payload }).strict();
}

export function sessionScopedEventSchema<
  TType extends RuntimeEventEnvelopeType,
  TPayloadSchema extends z.ZodTypeAny,
>(eventType: TType, payload: TPayloadSchema) {
  return SessionScopedRuntimeEventBaseSchema.extend({ eventType: z.literal(eventType), payload }).strict();
}

export function sessionActivityEventSchema<
  TType extends RuntimeEventEnvelopeType,
  TPayloadSchema extends z.ZodTypeAny,
>(eventType: TType, payload: TPayloadSchema) {
  return RuntimeEventBaseSchema.extend({
    sessionId: z.string().min(1),
    eventType: z.literal(eventType),
    payload,
  }).strict();
}

export type RuntimeEventSchemaOption = ReturnType<typeof eventSchema>;
