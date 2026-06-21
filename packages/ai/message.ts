// Defines provider-boundary messages and assistant content blocks for the AI package.
import { z } from 'zod';
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
    error: ProviderErrorSchema.optional(),
  })
  .strict();

export interface AssistantMessage {
  role: 'assistant';
  content: AssistantContentBlock[];
  stopReason?: string;
  usage?: TokenUsage;
  error?: ProviderError;
}

export const MessageSchema = z.discriminatedUnion('role', [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
]);
export type Message = UserMessage | AssistantMessage | ToolResultMessage;
