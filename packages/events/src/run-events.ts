/*
 * Run lifecycle, resume, and cancellation event contracts.
 */
import { z } from 'zod';
import {
  CancelReasonSchema,
  CancelRequestedBySchema,
  CancelScopeSchema,
  ResumeModeSchema,
  ResumeReasonSchema,
  ResumeRequestedBySchema,
  RunStatusSchema,
  SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES,
  SESSION_INTERRUPTED_RUN_REASONS,
  type CancelReason,
  type CancelRequestedBy,
  type CancelScope,
  type ResumeMode,
  type ResumeReason,
  type ResumeRequestedBy,
  type RunStatus,
  type SessionInterruptedRunPreviousStatus,
  type SessionInterruptedRunReason,
} from './internal/runtime-event-dependencies';
import { eventSchema } from './internal/event-schema-helpers';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-error';
import {
  createRequestRuntimeEvent,
  createRuntimeEvent,
  type RunRuntimeEventFactoryInput,
  type RuntimeEventRequestRef,
} from './runtime-event-factory';
import type { RuntimeEvent, TypedRuntimeEvent } from './runtime-event';

export interface ChatTokenUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
export interface RunCreatedPayload { status: RunStatus; mode: string; goal: string; triggerMessageId?: string }
export interface RunStartedPayload { providerId?: string; modelId?: string; runKind: 'chat' | 'agent' }
export interface RunStatusChangedPayload { from: RunStatus; to: RunStatus }
export interface RunCompletedPayload { assistantMessageId?: string; elapsedMs?: number; usage?: ChatTokenUsagePayload }
export interface RunFailedPayload { error: RuntimeError }
export interface RunCancelledPayload { reason?: string; error?: RuntimeError }
export interface RunInterruptedPayload {
  interruptedMarkerId: string;
  previousStatus: SessionInterruptedRunPreviousStatus;
  reason: SessionInterruptedRunReason;
}
export interface RunWaitingPayload { approvalRequestId: string; toolCallId: string; reason: string }
export interface RunResumeRequestedPayload {
  resumeRequestId: string;
  requestedBy: ResumeRequestedBy;
  reason: ResumeReason;
  resumeMode: ResumeMode;
  checkpointId?: string;
}
export interface RunResumedPayload { runApprovalId: string }
export interface RunResumeFailedPayload { resumeRequestId: string; error: RuntimeError }
export interface RunCancelRequestedPayload {
  cancelRequestId: string;
  requestedBy: CancelRequestedBy;
  reason: CancelReason;
  scope: CancelScope;
}
export interface RunCancellingPayload { cancelRequestId: string }
export interface RunPlanUpdatedPayload {
  toolCallId: string;
  explanation?: string;
  plan: readonly {
    readonly step: string;
    readonly status: 'pending' | 'in_progress' | 'completed';
  }[];
}

export interface RunEventPayloads {
  'run.created': RunCreatedPayload;
  'run.started': RunStartedPayload;
  'run.status.changed': RunStatusChangedPayload;
  'run.completed': RunCompletedPayload;
  'run.failed': RunFailedPayload;
  'run.cancelled': RunCancelledPayload;
  'run.interrupted': RunInterruptedPayload;
  'run.waiting': RunWaitingPayload;
  'run.resume.requested': RunResumeRequestedPayload;
  'run.resumed': RunResumedPayload;
  'run.resume.failed': RunResumeFailedPayload;
  'run.cancel.requested': RunCancelRequestedPayload;
  'run.cancelling': RunCancellingPayload;
  'run.plan.updated': RunPlanUpdatedPayload;
}
export type RunEventType = keyof RunEventPayloads;

export const ChatTokenUsagePayloadSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
}).strict();
const RunCreatedPayloadSchema = z.object({
  status: RunStatusSchema,
  mode: z.string().min(1),
  goal: z.string().min(1),
  triggerMessageId: z.string().min(1).optional(),
}).strict();
const RunStartedPayloadSchema = z.object({
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  runKind: z.enum(['chat', 'agent']),
}).strict();
const RunStatusChangedPayloadSchema = z.object({ from: RunStatusSchema, to: RunStatusSchema }).strict();
const RunCompletedPayloadSchema = z.object({
  assistantMessageId: z.string().min(1).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  usage: ChatTokenUsagePayloadSchema.optional(),
}).strict();
const RunFailedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();
const RunCancelledPayloadSchema = z.object({
  reason: z.string().min(1).optional(),
  error: RuntimeErrorSchema.optional(),
}).strict();
const RunInterruptedPayloadSchema = z.object({
  interruptedMarkerId: z.string().min(1),
  previousStatus: z.enum(SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES),
  reason: z.enum(SESSION_INTERRUPTED_RUN_REASONS),
}).strict();
const RunWaitingPayloadSchema = z.object({
  approvalRequestId: z.string().min(1),
  toolCallId: z.string().min(1),
  reason: z.string().min(1),
}).strict();
const RunResumeRequestedPayloadSchema = z.object({
  resumeRequestId: z.string().min(1),
  requestedBy: ResumeRequestedBySchema,
  reason: ResumeReasonSchema,
  resumeMode: ResumeModeSchema,
  checkpointId: z.string().min(1).optional(),
}).strict();
const RunResumedPayloadSchema = z.object({ runApprovalId: z.string().min(1) }).strict();
const RunResumeFailedPayloadSchema = z.object({
  resumeRequestId: z.string().min(1),
  error: RuntimeErrorSchema,
}).strict();
const RunCancelRequestedPayloadSchema = z.object({
  cancelRequestId: z.string().min(1),
  requestedBy: CancelRequestedBySchema,
  reason: CancelReasonSchema,
  scope: CancelScopeSchema,
}).strict();
const RunCancellingPayloadSchema = z.object({ cancelRequestId: z.string().min(1) }).strict();
const RunPlanUpdatedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  explanation: z.string().optional(),
  plan: z.array(z.object({
    step: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  }).strict()),
}).strict();

export const RunCreatedEventSchema = eventSchema('run.created', RunCreatedPayloadSchema);
export const RunStartedEventSchema = eventSchema('run.started', RunStartedPayloadSchema);
export const RunStatusChangedEventSchema = eventSchema('run.status.changed', RunStatusChangedPayloadSchema);
export const RunCompletedEventSchema = eventSchema('run.completed', RunCompletedPayloadSchema);
export const RunFailedEventSchema = eventSchema('run.failed', RunFailedPayloadSchema);
export const RunCancelledEventSchema = eventSchema('run.cancelled', RunCancelledPayloadSchema);
export const RunInterruptedEventSchema = eventSchema('run.interrupted', RunInterruptedPayloadSchema);
export const RunWaitingEventSchema = eventSchema('run.waiting', RunWaitingPayloadSchema);
export const RunResumeRequestedEventSchema = eventSchema('run.resume.requested', RunResumeRequestedPayloadSchema);
export const RunResumedEventSchema = eventSchema('run.resumed', RunResumedPayloadSchema);
export const RunResumeFailedEventSchema = eventSchema('run.resume.failed', RunResumeFailedPayloadSchema);
export const RunCancelRequestedEventSchema = eventSchema('run.cancel.requested', RunCancelRequestedPayloadSchema);
export const RunCancellingEventSchema = eventSchema('run.cancelling', RunCancellingPayloadSchema);
export const RunPlanUpdatedEventSchema = eventSchema('run.plan.updated', RunPlanUpdatedPayloadSchema);

export const RUN_EVENT_SCHEMAS = {
  'run.created': RunCreatedEventSchema,
  'run.started': RunStartedEventSchema,
  'run.status.changed': RunStatusChangedEventSchema,
  'run.completed': RunCompletedEventSchema,
  'run.failed': RunFailedEventSchema,
  'run.cancelled': RunCancelledEventSchema,
  'run.interrupted': RunInterruptedEventSchema,
  'run.waiting': RunWaitingEventSchema,
  'run.resume.requested': RunResumeRequestedEventSchema,
  'run.resumed': RunResumedEventSchema,
  'run.resume.failed': RunResumeFailedEventSchema,
  'run.cancel.requested': RunCancelRequestedEventSchema,
  'run.cancelling': RunCancellingEventSchema,
  'run.plan.updated': RunPlanUpdatedEventSchema,
} as const;

export function createRunEvent<TType extends RunEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}

export function createRunWaitingEvent(
  input: RunRuntimeEventFactoryInput<'run.waiting'>,
): TypedRuntimeEvent<'run.waiting'> {
  return createRuntimeEvent(input);
}

export function createRunStartedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
}): RuntimeEvent<RunStartedPayload> {
  return createRequestRuntimeEvent({
    ...input,
    eventType: 'run.started',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: {
      ...(input.request.providerId ? { providerId: input.request.providerId } : {}),
      ...(input.request.modelId ? { modelId: String(input.request.modelId) } : {}),
      runKind: 'agent',
    },
  });
}

export function createRunCompletedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
  payload?: RunCompletedPayload;
}): RuntimeEvent<RunCompletedPayload> {
  return createRequestRuntimeEvent({
    ...input,
    eventType: 'run.completed',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: input.payload ?? {},
  });
}

export function createRunFailedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
  error: RuntimeError;
}): RuntimeEvent<RunFailedPayload> {
  return createRequestRuntimeEvent({
    ...input,
    eventType: 'run.failed',
    source: input.error.source === 'provider' ? 'provider' : 'core',
    visibility: 'user',
    persist: 'required',
    payload: { error: input.error },
  });
}

export function createRunCancelledEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
  reason: string;
}): RuntimeEvent<RunCancelledPayload> {
  return createRequestRuntimeEvent({
    ...input,
    eventType: 'run.cancelled',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { reason: input.reason },
  });
}

export function createRunInterruptedEvent(input: Omit<
  RunRuntimeEventFactoryInput<'run.interrupted'>,
  'eventType' | 'source' | 'visibility' | 'persist'
>): TypedRuntimeEvent<'run.interrupted'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.interrupted',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createRuntimeRunResumeRequestedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'run.resume.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RunResumeRequestedPayload,
): TypedRuntimeEvent<'run.resume.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.resume.requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunCancelRequestedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'run.cancel.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RunCancelRequestedPayload,
): TypedRuntimeEvent<'run.cancel.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.cancel.requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRunResumeRequestedEvent(
  input: Omit<Parameters<typeof createRuntimeRunResumeRequestedEvent>[0], 'source'>,
  payload: RunResumeRequestedPayload,
): TypedRuntimeEvent<'run.resume.requested'> {
  return createRuntimeRunResumeRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createRunCancelRequestedEvent(
  input: Omit<Parameters<typeof createRuntimeRunCancelRequestedEvent>[0], 'source'>,
  payload: RunCancelRequestedPayload,
): TypedRuntimeEvent<'run.cancel.requested'> {
  return createRuntimeRunCancelRequestedEvent({ ...input, source: 'core' }, payload);
}
