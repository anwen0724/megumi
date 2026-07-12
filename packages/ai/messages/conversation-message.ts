/*
 * Provider-neutral conversation/context inputs and legacy provider responses.
 */
import { z } from 'zod';
import { ProviderErrorSchema, type ProviderError } from '../core/provider-error';
import { TokenUsageSchema, type TokenUsage } from '../core/token-usage';
import { JsonValueSchema, type JsonValue } from '../core/json';
import {
    AssistantContentBlockSchema,
    ContentBlockListSchema,
    type AssistantContentBlock,
    type ContentBlock,
} from './content-block';

export const ContextMessageKindSchema = z.enum([
    'skill_catalog',
    'compaction_summary',
    'memory_recall',
    'historical_run_state',
]);

export type ContextMessageKind = z.infer<typeof ContextMessageKindSchema>;

export const UserConversationItemSchema = z
    .object({
        type: z.literal('user_message'),
        content: ContentBlockListSchema,
    })
    .strict();

export const AssistantConversationItemSchema = z
    .object({
        type: z.literal('assistant_message'),
        content: ContentBlockListSchema,
    })
    .strict();

export const ToolCallConversationItemSchema = z
    .object({
        type: z.literal('tool_call'),
        toolCallId: z.string().min(1),
        toolName: z.string().min(1),
        arguments: JsonValueSchema,
    })
    .strict();

export const ToolResultConversationItemSchema = z
    .object({
        type: z.literal('tool_result'),
        toolCallId: z.string().min(1),
        toolName: z.string().min(1),
        status: z.enum(['success', 'failure']),
        content: ContentBlockListSchema,
    })
    .strict();

export const ContextConversationItemSchema = z
    .object({
        type: z.literal('context'),
        kind: ContextMessageKindSchema,
        content: JsonValueSchema,
    })
    .strict();

export const ConversationItemSchema = z.discriminatedUnion('type', [
    UserConversationItemSchema,
    AssistantConversationItemSchema,
    ToolCallConversationItemSchema,
    ToolResultConversationItemSchema,
    ContextConversationItemSchema,
]);

export type ConversationItem =
    | { type: 'user_message'; content: ContentBlock[] }
    | { type: 'assistant_message'; content: ContentBlock[] }
    | {
        type: 'tool_call';
        toolCallId: string;
        toolName: string;
        arguments: JsonValue;
    }
    | {
        type: 'tool_result';
        toolCallId: string;
        toolName: string;
        status: 'success' | 'failure';
        content: ContentBlock[];
    }
    | {
        type: 'context';
        kind: ContextMessageKind;
        content: JsonValue;
    };

export const ConversationItemListSchema = z.array(ConversationItemSchema);

export const UserMessageSchema = z
    .object({
        role: z.literal('user'),
        content: z.string(),
    })
    .strict();

export interface UserMessage {
    role: 'user';
    content: string;
}

export const ToolResultMessageSchema = z
    .object({
        role: z.literal('toolResult'),
        toolCallId: z.string().min(1),
        content: z.string(),
    })
    .strict();

export interface ToolResultMessage {
    role: 'toolResult';
    toolCallId: string;
    content: string;
}

export const ContextMessageSchema = z
    .object({
        role: z.literal('context'),
        kind: ContextMessageKindSchema,
        content: JsonValueSchema,
    })
    .strict();

export interface ContextMessage {
    role: 'context';
    kind: ContextMessageKind;
    content: JsonValue;
}

export const AssistantMessageSchema = z
    .object({
        role: z.literal('assistant'),
        content: z.array(AssistantContentBlockSchema),
        stopReason: z.string().min(1).optional(),
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

export const ConversationMessageSchema = z.discriminatedUnion('role', [
    UserMessageSchema,
    AssistantMessageSchema,
    ToolResultMessageSchema,
    ContextMessageSchema,
]);

export type ConversationMessage =
    | UserMessage
    | AssistantMessage
    | ToolResultMessage
    | ContextMessage;

export type Message = ConversationMessage;

export function getAssistantText(message: AssistantMessage): string {
    return message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
}
