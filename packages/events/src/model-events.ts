/*
 * Assistant and model-call event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import { ContentBlockListSchema, JsonValueSchema, type ContentBlock, type JsonValue } from '@megumi/ai';
import { eventSchema } from './internal/event-schema-helpers';
import {
  createRequestRuntimeEvent,
  createRuntimeEvent,
  type RunRuntimeEventFactoryInput,
  type RuntimeEventRequestRef,
} from './runtime-event-factory';
import type { RuntimeEvent, TypedRuntimeEvent } from './runtime-event';
import { ChatTokenUsagePayloadSchema, type ChatTokenUsagePayload } from './run-events';

export interface AssistantOutputDeltaPayload { delta: string }
export interface AssistantOutputCompletedPayload {
  content: string;
  messageId?: string;
  usage?: ChatTokenUsagePayload;
}
export interface ModelCallStartedPayload { modelCallId: string; providerId: string; modelId: string }
export interface ModelCallTextDeltaPayload { modelCallId: string; delta: string }
export interface ModelCallProjectionResetPayload { modelCallId: string; failedAttemptNumber: number }
export interface ModelCallCompletedPayload {
  modelCallId: string;
  finishReason: 'stop' | 'tool_calls' | 'cancelled' | 'failed' | string;
  content?: ContentBlock[];
}
export interface ModelCallToolCallPayload {
  modelCallId: string;
  toolCallId: string;
  providerToolCallId?: string;
  toolName: string;
  input: JsonValue;
}
export interface ModelThinkingStartedPayload { modelCallId: string }
export interface ModelThinkingDeltaPayload { modelCallId: string; delta: string }
export interface ModelThinkingCompletedPayload { modelCallId: string }
export interface ModelToolCallDetectedPayload {
  modelCallId: string;
  toolCallId: string;
  providerToolCallId: string;
  toolName: string;
}

export interface ModelEventPayloads {
  'assistant.output.delta': AssistantOutputDeltaPayload;
  'assistant.output.completed': AssistantOutputCompletedPayload;
  'model_call.started': ModelCallStartedPayload;
  'model_call.text_delta': ModelCallTextDeltaPayload;
  'model_call.projection_reset': ModelCallProjectionResetPayload;
  'model_call.completed': ModelCallCompletedPayload;
  'model_call.tool_call': ModelCallToolCallPayload;
  'model.thinking.started': ModelThinkingStartedPayload;
  'model.thinking.delta': ModelThinkingDeltaPayload;
  'model.thinking.completed': ModelThinkingCompletedPayload;
  'model.tool_call.detected': ModelToolCallDetectedPayload;
}
export type ModelEventType = keyof ModelEventPayloads;

const AssistantOutputDeltaPayloadSchema = z.object({ delta: z.string() }).strict();
const AssistantOutputCompletedPayloadSchema = z.object({
  content: z.string(),
  messageId: z.string().min(1).optional(),
  usage: ChatTokenUsagePayloadSchema.optional(),
}).strict();
const ModelCallStartedPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict();
const ModelCallTextDeltaPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  delta: z.string(),
}).strict();
const ModelCallProjectionResetPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  failedAttemptNumber: z.number().int().positive(),
}).strict();
const StructuredModelCallCompletedPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  finishReason: z.string().min(1),
  content: ContentBlockListSchema.optional(),
}).strict();
const LegacyModelCallCompletedPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  finishReason: z.string().min(1),
  content: z.string(),
}).strict();
const ModelCallCompletedPayloadSchema = z
  .union([StructuredModelCallCompletedPayloadSchema, LegacyModelCallCompletedPayloadSchema])
  .transform((payload) => typeof payload.content === 'string'
    ? { ...payload, content: [{ type: 'text' as const, text: payload.content }] }
    : payload);
const ModelCallToolCallPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  toolCallId: z.string().min(1),
  providerToolCallId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  input: JsonValueSchema,
}).strict();
const ModelThinkingStartedPayloadSchema = z.object({ modelCallId: z.string().min(1) }).strict();
const ModelThinkingDeltaPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  delta: z.string(),
}).strict();
const ModelThinkingCompletedPayloadSchema = z.object({ modelCallId: z.string().min(1) }).strict();
const ModelToolCallDetectedPayloadSchema = z.object({
  modelCallId: z.string().min(1),
  toolCallId: z.string().min(1),
  providerToolCallId: z.string().min(1),
  toolName: z.string().min(1),
}).strict();

export const AssistantOutputDeltaEventSchema = eventSchema('assistant.output.delta', AssistantOutputDeltaPayloadSchema);
export const AssistantOutputCompletedEventSchema = eventSchema('assistant.output.completed', AssistantOutputCompletedPayloadSchema);
export const ModelCallStartedEventSchema = eventSchema('model_call.started', ModelCallStartedPayloadSchema);
export const ModelCallTextDeltaEventSchema = eventSchema('model_call.text_delta', ModelCallTextDeltaPayloadSchema);
export const ModelCallProjectionResetEventSchema = eventSchema('model_call.projection_reset', ModelCallProjectionResetPayloadSchema);
export const ModelCallCompletedEventSchema = eventSchema('model_call.completed', ModelCallCompletedPayloadSchema);
export const ModelCallToolCallEventSchema = eventSchema('model_call.tool_call', ModelCallToolCallPayloadSchema);
export const ModelThinkingStartedEventSchema = eventSchema('model.thinking.started', ModelThinkingStartedPayloadSchema);
export const ModelThinkingDeltaEventSchema = eventSchema('model.thinking.delta', ModelThinkingDeltaPayloadSchema);
export const ModelThinkingCompletedEventSchema = eventSchema('model.thinking.completed', ModelThinkingCompletedPayloadSchema);
export const ModelToolCallDetectedEventSchema = eventSchema('model.tool_call.detected', ModelToolCallDetectedPayloadSchema);

export const MODEL_EVENT_SCHEMAS = {
  'assistant.output.delta': AssistantOutputDeltaEventSchema,
  'assistant.output.completed': AssistantOutputCompletedEventSchema,
  'model_call.started': ModelCallStartedEventSchema,
  'model_call.text_delta': ModelCallTextDeltaEventSchema,
  'model_call.projection_reset': ModelCallProjectionResetEventSchema,
  'model_call.completed': ModelCallCompletedEventSchema,
  'model_call.tool_call': ModelCallToolCallEventSchema,
  'model.thinking.started': ModelThinkingStartedEventSchema,
  'model.thinking.delta': ModelThinkingDeltaEventSchema,
  'model.thinking.completed': ModelThinkingCompletedEventSchema,
  'model.tool_call.detected': ModelToolCallDetectedEventSchema,
} as const;

export function createModelEvent<TType extends ModelEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
export function createModelThinkingStartedEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.started'>,
): TypedRuntimeEvent<'model.thinking.started'> { return createRuntimeEvent(input); }
export function createModelThinkingDeltaEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.delta'>,
): TypedRuntimeEvent<'model.thinking.delta'> { return createRuntimeEvent(input); }
export function createModelThinkingCompletedEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.completed'>,
): TypedRuntimeEvent<'model.thinking.completed'> { return createRuntimeEvent(input); }
export function createModelToolCallDetectedEvent(
  input: RunRuntimeEventFactoryInput<'model.tool_call.detected'>,
): TypedRuntimeEvent<'model.tool_call.detected'> { return createRuntimeEvent(input); }

export function createAssistantDeltaEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
  delta: string;
}): RuntimeEvent<AssistantOutputDeltaPayload> {
  return createRequestRuntimeEvent({
    eventId: input.eventId,
    eventType: 'assistant.output.delta',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'transient',
    payload: { delta: input.delta },
  });
}

export function createAssistantCompletedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: string;
  sequence: number;
  createdAt: string;
  payload: AssistantOutputCompletedPayload;
}): RuntimeEvent<AssistantOutputCompletedPayload> {
  return createRequestRuntimeEvent({
    ...input,
    eventType: 'assistant.output.completed',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
  });
}
