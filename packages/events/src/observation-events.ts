/*
 * Observation event payload, schema, and factory.
 */
import { z } from 'zod';
import {
  RunObservationSourceSchema,
  type RunObservationSource,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface ObservationReceivedPayload {
  source: RunObservationSource;
  kind: string;
  summary?: string;
}
export interface ObservationEventPayloads { 'observation.received': ObservationReceivedPayload }
export type ObservationEventType = keyof ObservationEventPayloads;

const ObservationReceivedPayloadSchema = z.object({
  source: RunObservationSourceSchema,
  kind: z.string().min(1),
  summary: z.string().optional(),
}).strict();

export const ObservationReceivedEventSchema = eventSchema(
  'observation.received',
  ObservationReceivedPayloadSchema,
);
export const OBSERVATION_EVENT_SCHEMAS = {
  'observation.received': ObservationReceivedEventSchema,
} as const;

export function createObservationEvent(
  input: RunRuntimeEventFactoryInput<'observation.received'>,
): TypedRuntimeEvent<'observation.received'> {
  return createRuntimeEvent(input);
}
