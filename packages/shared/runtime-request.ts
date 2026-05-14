import { z } from 'zod';
import { RuntimeContextSchema, type RuntimeContext } from './runtime-context';

export interface RuntimeRequest<TPayload> {
  context: RuntimeContext;
  payload: TPayload;
}

export const RuntimeRequestSchema = z
  .object({
    context: RuntimeContextSchema,
    payload: z.unknown(),
  })
  .strict();

export function createRuntimeRequestSchema<TPayload extends z.ZodTypeAny>(
  payloadSchema: TPayload,
) {
  return z
    .object({
      context: RuntimeContextSchema,
      payload: payloadSchema,
    })
    .strict();
}

export function createRuntimeRequest<TPayload>(
  context: RuntimeContext,
  payload: TPayload,
): RuntimeRequest<TPayload> {
  return {
    context,
    payload,
  };
}
