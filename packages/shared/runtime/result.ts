import { z } from 'zod';
import { RuntimeResultMetaSchema, type RuntimeResultMeta } from '../runtime/context';
import { RuntimeErrorSchema, type RuntimeError } from '../runtime/errors';

export function RuntimeSuccessSchema<TData extends z.ZodTypeAny>(dataSchema: TData) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      meta: RuntimeResultMetaSchema,
    })
    .strict();
}

export const RuntimeFailureSchema = z
  .object({
    ok: z.literal(false),
    error: RuntimeErrorSchema,
    meta: RuntimeResultMetaSchema,
  })
  .strict();

export function createRuntimeResultSchema<TData extends z.ZodTypeAny>(dataSchema: TData) {
  return z.discriminatedUnion('ok', [
    RuntimeSuccessSchema(dataSchema),
    RuntimeFailureSchema,
  ]);
}

export interface RuntimeSuccess<TData> {
  ok: true;
  data: TData;
  meta: RuntimeResultMeta;
}

export interface RuntimeFailure {
  ok: false;
  error: RuntimeError;
  meta: RuntimeResultMeta;
}

export type RuntimeResult<TData> = RuntimeSuccess<TData> | RuntimeFailure;

