// Defines provider-boundary messages and assistant content blocks for src AI.
import { z } from 'zod';
import { MegumiErrorSchema, type MegumiError } from '../shared';
import { ProviderErrorSchema, type ProviderError } from './errors';
import { TokenUsageSchema, type TokenUsage } from './usage';

export const TextContentBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).strict();
export interface TextContentBlock { type: 'text'; text: string }

export const ThinkingContentBlockSchema = z.object({ type: z.literal('thinking'), thinking: z.string() }).strict();
export interface ThinkingContentBlock { type: 'thinking'; thinking: string }

export const ToolCallContentBlockSchema = z
  .object({
    type: z.literal('toolCall'),
    id: z.string().min(1),
    name: z.string().min(1),
    argumentsText: z.string(),
  })
  .strict();
export interface ToolCallContentBlock { type: 'toolCall'; id: string; name: string; argumentsText: string }

export const AssistantContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ThinkingContentBlockSchema,
  ToolCallContentBlockSchema,
]);
export type AssistantContentBlock = TextContentBlock | ThinkingContentBlock | ToolCallContentBlock;

export const UserMessageSchema = z.object({ role: z.literal('user'), content: z.string() }).strict();
export interface UserMessage { role: 'user'; content: string }

export const ToolResultMessageSchema = z
  .object({
    role: z.literal('toolResult'),
    toolCallId: z.string().min(1),
    content: z.string(),
  })
  .strict();
export interface ToolResultMessage { role: 'toolResult'; toolCallId: string; content: string }

export const AssistantMessageSchema = z
  .object({
    role: z.literal('assistant'),
    content: z.array(AssistantContentBlockSchema),
    stopReason: z.string().min(1).refine((reason) => !/^tool[_A-Z]?use$/i.test(reason)).optional(),
    usage: TokenUsageSchema.optional(),
    error: z.union([ProviderErrorSchema, MegumiErrorSchema]).optional(),
  })
  .strict();

export interface AssistantMessage {
  role: 'assistant';
  content: AssistantContentBlock[];
  stopReason?: string;
  usage?: TokenUsage;
  error?: ProviderError | MegumiError;
}

export const MessageSchema = z.discriminatedUnion('role', [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
]);
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export function createTextBlock(input: { text: string }): TextContentBlock {
  return TextContentBlockSchema.parse({ type: 'text', text: input.text });
}

export function createThinkingBlock(input: { thinking: string }): ThinkingContentBlock {
  return ThinkingContentBlockSchema.parse({ type: 'thinking', thinking: input.thinking });
}

export function createToolCallBlock(input: { id: string; name: string; argumentsText: string }): ToolCallContentBlock {
  return ToolCallContentBlockSchema.parse({
    type: 'toolCall',
    id: input.id,
    name: input.name,
    argumentsText: input.argumentsText,
  });
}
