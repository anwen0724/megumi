import { z } from 'zod';
import { ProviderErrorSchema, type ProviderError } from '../core/provider-error';
import { TokenUsageSchema, type TokenUsage } from '../core/token-usage';
import {
    AssistantContentBlockSchema,
    type AssistantContentBlock,
} from './content-block';

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
]);

export type ConversationMessage =
    | UserMessage
    | AssistantMessage
    | ToolResultMessage;

export type Message = ConversationMessage;

export function getAssistantText(message: AssistantMessage): string {
    return message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
}