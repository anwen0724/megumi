import { z } from 'zod';
import type { IsoDateTime } from '../primitives/ids';
import {
  IsoDateTimeSchema,
  RuntimeDebugIdSchema,
  RuntimeIdSchema,
  RuntimeOperationNameSchema,
  RuntimeSourceSchema,
  RuntimeTraceIdSchema,
  type RuntimeSource,
} from '../runtime/validation';

export const RuntimeContextSchema = z
  .object({
    requestId: RuntimeIdSchema,
    traceId: RuntimeTraceIdSchema,
    debugId: RuntimeDebugIdSchema.optional(),
    operationName: RuntimeOperationNameSchema,
    source: RuntimeSourceSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type RuntimeContext = z.infer<typeof RuntimeContextSchema>;

export const RuntimeResultMetaSchema = z
  .object({
    requestId: RuntimeIdSchema.optional(),
    traceId: RuntimeTraceIdSchema.optional(),
    debugId: RuntimeDebugIdSchema.optional(),
    operationName: RuntimeOperationNameSchema.optional(),
    handledAt: IsoDateTimeSchema,
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

export type RuntimeResultMeta = z.infer<typeof RuntimeResultMetaSchema>;

export interface CreateRuntimeContextInput {
  requestId: string;
  traceId?: string;
  debugId?: string;
  operationName: string;
  source: RuntimeSource;
  createdAt?: IsoDateTime;
}

function createRuntimeId(prefix: 'trace' | 'debug'): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${random}`;
}

export function createRuntimeTraceId(): string {
  return createRuntimeId('trace');
}

export function createRuntimeDebugId(): string {
  return createRuntimeId('debug');
}

export function createRuntimeContext(input: CreateRuntimeContextInput): RuntimeContext {
  const candidate: RuntimeContext = {
    requestId: input.requestId,
    traceId: input.traceId ?? createRuntimeTraceId(),
    operationName: input.operationName,
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  if (input.debugId) {
    candidate.debugId = input.debugId;
  }

  return RuntimeContextSchema.parse(candidate);
}

export {
  IsoDateTimeSchema,
  RuntimeDebugIdSchema,
  RuntimeIdSchema,
  RuntimeOperationNameSchema,
  RuntimeSourceSchema,
  RuntimeTraceIdSchema,
  type RuntimeSource,
};

