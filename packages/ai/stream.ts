// Defines assistant message stream events around content block lifecycles.
import { z } from 'zod';
import {
  AssistantContentBlockSchema,
  AssistantMessageSchema,
  type AssistantContentBlock,
  type AssistantMessage,
} from './message';
import { type ModelContextInput } from './context';
import { AssistantMessageEventStream } from './event-stream';
import { createProviderError } from './errors';
import { type Model } from './model';
import { type AiRequestOptions } from './request';
import { type ToolSet } from './tool-set';

export const TextDeltaSchema = z.object({ type: z.literal('text_delta'), text: z.string() }).strict();
export const ThinkingDeltaSchema = z.object({ type: z.literal('thinking_delta'), thinking: z.string() }).strict();
export const ToolCallDeltaSchema = z
  .object({
    type: z.literal('tool_call_delta'),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    argumentsTextDelta: z.string().optional(),
  })
  .strict();

export const AssistantContentBlockDeltaSchema = z.discriminatedUnion('type', [
  TextDeltaSchema,
  ThinkingDeltaSchema,
  ToolCallDeltaSchema,
]);
export type AssistantContentBlockDelta = z.infer<typeof AssistantContentBlockDeltaSchema>;

export const ToolCallStartContentBlockSchema = z
  .object({
    type: z.literal('toolCall'),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    argumentsText: z.string().optional(),
  })
  .strict();

export const AssistantContentBlockStartSchema = z.discriminatedUnion('type', [
  AssistantContentBlockSchema.options[0],
  AssistantContentBlockSchema.options[1],
  ToolCallStartContentBlockSchema,
]);

export type AssistantContentBlockStart = z.infer<typeof AssistantContentBlockStartSchema>;

export const AssistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_start'), messageId: z.string().min(1), role: z.literal('assistant') }).strict(),
  z.object({ type: z.literal('content_block_start'), index: z.number().int().nonnegative(), block: AssistantContentBlockStartSchema }).strict(),
  z.object({ type: z.literal('content_block_delta'), index: z.number().int().nonnegative(), delta: AssistantContentBlockDeltaSchema }).strict(),
  z.object({ type: z.literal('content_block_end'), index: z.number().int().nonnegative(), block: AssistantContentBlockSchema }).strict(),
  z.object({ type: z.literal('message_end'), message: AssistantMessageSchema }).strict(),
  z.object({
    type: z.literal('error'),
    reason: z.enum(['error', 'aborted']),
    message: AssistantMessageSchema,
  }).strict(),
]);

export type AssistantStreamEvent =
  | { type: 'message_start'; messageId: string; role: 'assistant' }
  | { type: 'content_block_start'; index: number; block: AssistantContentBlockStart }
  | { type: 'content_block_delta'; index: number; delta: AssistantContentBlockDelta }
  | { type: 'content_block_end'; index: number; block: AssistantContentBlock }
  | { type: 'message_end'; message: AssistantMessage }
  | { type: 'error'; reason: 'error' | 'aborted'; message: AssistantMessage };

export function stream(
  model: Model,
  context: ModelContextInput,
  options: AiRequestOptions,
  toolSet?: ToolSet,
): AssistantMessageEventStream {
  if (!options.registry) {
    const error = createProviderError({
      providerId: model.providerId,
      modelId: model.modelId,
      code: 'registry_error',
      message: 'AI provider registry is required.',
      retryable: false,
    });
    return AssistantMessageEventStream.from([
      {
        type: 'error',
        reason: 'error',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          error,
        },
      },
    ]);
  }

  try {
    const adapter = options.registry.get(model.providerId);
    return adapter.stream({ model, context, toolSet, options });
  } catch (error) {
    const providerError = createProviderError({
      providerId: model.providerId,
      modelId: model.modelId,
      code: 'registry_error',
      message: 'AI provider registry lookup failed.',
      retryable: false,
      details: {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    return AssistantMessageEventStream.from([
      {
        type: 'error',
        reason: 'error',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          error: providerError,
        },
      },
    ]);
  }
}
