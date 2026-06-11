import { z } from 'zod';

export const RuntimeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'Runtime id must contain only letters, numbers, colon, underscore, or hyphen.');

export const RuntimeTraceIdSchema = RuntimeIdSchema.regex(
  /^trace-[A-Za-z0-9:_-]+$/,
  'traceId must start with trace-.',
);

export const RuntimeDebugIdSchema = RuntimeIdSchema.regex(
  /^debug-[A-Za-z0-9:_-]+$/,
  'debugId must start with debug-.',
);

export const RuntimeOperationNameSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
    'operationName must use lowercase dotted names such as provider.list.',
  );

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const RUNTIME_SOURCES = [
  'renderer',
  'preload',
  'main',
  'core',
  'provider',
  'config',
  'database',
  'filesystem',
  'security',
  'tool',
  'approval',
  'workspace',
  'memory',
  'artifact',
  'unknown',
] as const;

export type RuntimeSource = (typeof RUNTIME_SOURCES)[number];

const RUNTIME_SOURCE_VALUES = [...RUNTIME_SOURCES] as [RuntimeSource, ...RuntimeSource[]];

export const RuntimeSourceSchema = z.enum(RUNTIME_SOURCE_VALUES);
