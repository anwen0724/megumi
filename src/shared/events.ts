// Defines a generic platform event envelope for src modules and tests.
import { z } from 'zod';
import { ErrorSourceSchema, type ErrorSource } from './errors';
import { type EntityId, type IsoDateTime } from './ids';
import { JsonObjectSchema, type JsonObject } from './json';

export type PlatformEventId = EntityId<'PlatformEventId'>;

export const PlatformEventSchema = z
  .object({
    eventId: z.string().min(1),
    type: z.string().min(1),
    occurredAt: z.string().min(1),
    source: ErrorSourceSchema,
    payload: JsonObjectSchema,
  })
  .strict();

export interface PlatformEvent<
  TType extends string = string,
  TPayload extends JsonObject = JsonObject,
> {
  eventId: PlatformEventId;
  type: TType;
  occurredAt: IsoDateTime;
  source: ErrorSource;
  payload: TPayload;
}

export function createPlatformEvent<
  TType extends string,
  TPayload extends JsonObject,
>(event: PlatformEvent<TType, TPayload>): PlatformEvent<TType, TPayload> {
  PlatformEventSchema.parse(event);
  return event;
}
