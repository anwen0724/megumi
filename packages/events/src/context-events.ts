/*
 * Context patch and compaction event contracts.
 */
import { z } from 'zod';
import {
  CONTEXT_PATCH_OPERATIONS,
  CONTEXT_PATCH_REQUESTERS,
  ModelInputContextSourceRefSchema,
  SESSION_COMPACTION_TRIGGER_REASONS,
  type ContextEffectiveUpdatedPayload,
  type ContextPatchAppliedPayload,
  type ContextPatchRejectedPayload,
  type ContextPatchRequestedPayload,
  type ModelInputContextSourceRef,
  type SessionCompactionTriggerReason,
} from './internal/runtime-event-dependencies';
import { eventSchema, sessionActivityEventSchema } from './internal/event-schema-helpers';
import { RuntimeErrorSchema, type RuntimeContext, type RuntimeError } from './runtime-error';
import {
  createRuntimeEvent,
  createSessionScopedRuntimeEvent,
  type RunRuntimeEventFactoryInput,
} from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
};

export interface ContextCompactionStartedPayload {
  compactionId: string;
  triggerReason: SessionCompactionTriggerReason;
  tokensBefore: number;
  firstKeptSourceRef: ModelInputContextSourceRef;
  summarizedSourceCount: number;
  previousCompactionId?: string;
}
export interface ContextCompactionCompletedPayload extends ContextCompactionStartedPayload {
  readFiles?: string[];
  modifiedFiles?: string[];
}
export interface ContextCompactionFailedPayload {
  compactionId?: string;
  triggerReason: SessionCompactionTriggerReason;
  tokensBefore: number;
  error: RuntimeError;
  previousCompactionId?: string;
}

export interface ContextEventPayloads {
  'context.patch.requested': ContextPatchRequestedPayload;
  'context.patch.applied': ContextPatchAppliedPayload;
  'context.patch.rejected': ContextPatchRejectedPayload;
  'context.effective.updated': ContextEffectiveUpdatedPayload;
  'context.compaction.started': ContextCompactionStartedPayload;
  'context.compaction.completed': ContextCompactionCompletedPayload;
  'context.compaction.failed': ContextCompactionFailedPayload;
}
export type ContextEventType = keyof ContextEventPayloads;

const ContextPatchRequestedPayloadSchema = z.object({
  patchId: z.string().min(1),
  operation: z.enum(CONTEXT_PATCH_OPERATIONS),
  requestedBy: z.enum(CONTEXT_PATCH_REQUESTERS),
  reason: z.string().min(1),
}).strict();
const ContextPatchAppliedPayloadSchema = z.object({
  patchId: z.string().min(1),
  operation: z.enum(CONTEXT_PATCH_OPERATIONS),
  effectiveContextBuildId: z.string().min(1).optional(),
}).strict();
const ContextPatchRejectedPayloadSchema = z.object({
  patchId: z.string().min(1),
  operation: z.enum(CONTEXT_PATCH_OPERATIONS),
  rejectionReason: z.string().min(1),
}).strict();
const ContextEffectiveUpdatedPayloadSchema = z.object({
  contextId: z.string().min(1),
  effectiveContextBuildId: z.string().min(1),
  sourceCount: z.number().int().nonnegative(),
  redactionCount: z.number().int().nonnegative(),
  truncationCount: z.number().int().nonnegative(),
}).strict();
const ContextCompactionStartedPayloadSchema = z.object({
  compactionId: z.string().min(1).max(128),
  triggerReason: z.enum(SESSION_COMPACTION_TRIGGER_REASONS),
  tokensBefore: z.number().int().nonnegative(),
  firstKeptSourceRef: ModelInputContextSourceRefSchema,
  summarizedSourceCount: z.number().int().nonnegative(),
  previousCompactionId: z.string().min(1).max(128).optional(),
}).strict();
const ContextCompactionCompletedPayloadSchema = ContextCompactionStartedPayloadSchema.extend({
  readFiles: z.array(z.string().min(1)).optional(),
  modifiedFiles: z.array(z.string().min(1)).optional(),
}).strict();
const ContextCompactionFailedPayloadSchema = z.object({
  compactionId: z.string().min(1).max(128).optional(),
  triggerReason: z.enum(SESSION_COMPACTION_TRIGGER_REASONS),
  tokensBefore: z.number().int().nonnegative(),
  previousCompactionId: z.string().min(1).max(128).optional(),
  error: RuntimeErrorSchema,
}).strict();

export const ContextPatchRequestedEventSchema = eventSchema(
  'context.patch.requested', ContextPatchRequestedPayloadSchema,
);
export const ContextPatchAppliedEventSchema = eventSchema(
  'context.patch.applied', ContextPatchAppliedPayloadSchema,
);
export const ContextPatchRejectedEventSchema = eventSchema(
  'context.patch.rejected', ContextPatchRejectedPayloadSchema,
);
export const ContextEffectiveUpdatedEventSchema = eventSchema(
  'context.effective.updated', ContextEffectiveUpdatedPayloadSchema,
);
export const ContextCompactionStartedEventSchema = sessionActivityEventSchema(
  'context.compaction.started', ContextCompactionStartedPayloadSchema,
);
export const ContextCompactionCompletedEventSchema = sessionActivityEventSchema(
  'context.compaction.completed', ContextCompactionCompletedPayloadSchema,
);
export const ContextCompactionFailedEventSchema = sessionActivityEventSchema(
  'context.compaction.failed', ContextCompactionFailedPayloadSchema,
);

export const CONTEXT_EVENT_SCHEMAS = {
  'context.patch.requested': ContextPatchRequestedEventSchema,
  'context.patch.applied': ContextPatchAppliedEventSchema,
  'context.patch.rejected': ContextPatchRejectedEventSchema,
  'context.effective.updated': ContextEffectiveUpdatedEventSchema,
  'context.compaction.started': ContextCompactionStartedEventSchema,
  'context.compaction.completed': ContextCompactionCompletedEventSchema,
  'context.compaction.failed': ContextCompactionFailedEventSchema,
} as const;

type ContextFactoryBase<TPayload> = {
  eventId: string;
  runId: string;
  sessionId?: string;
  actionId?: string;
  observationId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: TPayload;
};

export function createContextPatchRequestedEvent(
  input: ContextFactoryBase<ContextPatchRequestedPayload>,
): TypedRuntimeEvent<'context.patch.requested'> {
  return createRuntimeEvent({ ...input, eventType: 'context.patch.requested', source: 'core', visibility: 'debug', persist: 'required' });
}
export function createContextPatchAppliedEvent(
  input: ContextFactoryBase<ContextPatchAppliedPayload>,
): TypedRuntimeEvent<'context.patch.applied'> {
  return createRuntimeEvent({ ...input, eventType: 'context.patch.applied', source: 'core', visibility: 'debug', persist: 'required' });
}
export function createContextPatchRejectedEvent(
  input: ContextFactoryBase<ContextPatchRejectedPayload>,
): TypedRuntimeEvent<'context.patch.rejected'> {
  return createRuntimeEvent({ ...input, eventType: 'context.patch.rejected', source: 'core', visibility: 'debug', persist: 'required' });
}
export function createContextEffectiveUpdatedEvent(
  input: Omit<ContextFactoryBase<ContextEffectiveUpdatedPayload>, 'actionId' | 'observationId'>,
): TypedRuntimeEvent<'context.effective.updated'> {
  return createRuntimeEvent({ ...input, eventType: 'context.effective.updated', source: 'core', visibility: 'debug', persist: 'required' });
}

type CompactionFactoryInput<TType extends 'context.compaction.started' | 'context.compaction.completed' | 'context.compaction.failed'> = {
  eventId: string;
  sessionId: string;
  requestId?: string;
  sequence: number;
  createdAt: string;
  context?: RuntimeContext;
  payload: ContextEventPayloads[TType];
};

export function createContextCompactionStartedEvent(
  input: CompactionFactoryInput<'context.compaction.started'>,
): TypedRuntimeEvent<'context.compaction.started'> {
  return createSessionScopedRuntimeEvent({ ...input, eventType: 'context.compaction.started', source: 'main', visibility: 'system', persist: 'required' });
}
export function createContextCompactionCompletedEvent(
  input: CompactionFactoryInput<'context.compaction.completed'>,
): TypedRuntimeEvent<'context.compaction.completed'> {
  return createSessionScopedRuntimeEvent({ ...input, eventType: 'context.compaction.completed', source: 'main', visibility: 'system', persist: 'required' });
}
export function createContextCompactionFailedEvent(
  input: CompactionFactoryInput<'context.compaction.failed'>,
): TypedRuntimeEvent<'context.compaction.failed'> {
  return createSessionScopedRuntimeEvent({ ...input, eventType: 'context.compaction.failed', source: 'main', visibility: 'system', persist: 'required' });
}

export function createContextEvent<TType extends Exclude<ContextEventType, `context.compaction.${string}`>>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
