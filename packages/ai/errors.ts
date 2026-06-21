// Defines typed AI provider errors without leaking raw provider internals.
import { z } from 'zod';
import { type JsonObject } from '@megumi/shared/primitives/json';

export const ProviderErrorCodeSchema = z.enum([
  'credential_error',
  'provider_http_error',
  'rate_limited',
  'token_limited',
  'stream_parse_error',
  'stream_source_error',
  'registry_error',
  'unknown_provider_error',
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

export const ProviderErrorSchema = z
  .object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    code: ProviderErrorCodeSchema,
    message: z.string().min(1),
    severity: z.literal('error'),
    source: z.literal('ai'),
    retryable: z.boolean(),
    debugId: z.string().min(1).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ProviderError = z.infer<typeof ProviderErrorSchema>;

export function createProviderError(input: {
  providerId: string;
  modelId: string;
  code: ProviderErrorCode;
  message: string;
  retryable?: boolean;
  details?: JsonObject;
}): ProviderError {
  return ProviderErrorSchema.parse(stripUndefined({
    providerId: input.providerId,
    modelId: input.modelId,
    code: input.code,
    message: input.message,
    severity: 'error',
    source: 'ai',
    retryable: input.retryable ?? false,
    details: {
      providerId: input.providerId,
      modelId: input.modelId,
      ...(input.details ?? {}),
    },
  }));
}

export class AiRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRegistryError';
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
