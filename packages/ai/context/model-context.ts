import { z } from 'zod';
import {
    ConversationMessageSchema,
    type ConversationMessage,
    type UserMessage,
    type AssistantMessage,
    type ToolResultMessage,
} from '../messages/conversation-message';

export const ModelContextSchema = z
    .object({
        systemPrompt: z.string().optional(),
        messages: z.array(ConversationMessageSchema),
    })
    .strict();

export interface ModelContext {
    systemPrompt?: string;
    messages: ConversationMessage[];
}

export function defineModelContext(context: ModelContext): ModelContext {
    return ModelContextSchema.parse(context);
}

export function getUserMessages(context: ModelContext): UserMessage[] {
    return context.messages.filter(
        (message): message is UserMessage => message.role === 'user',
    );
}

export function getAssistantMessages(context: ModelContext): AssistantMessage[] {
    return context.messages.filter(
        (message): message is AssistantMessage => message.role === 'assistant',
    );
}

export function getToolResultMessages(context: ModelContext): ToolResultMessage[] {
    return context.messages.filter(
        (message): message is ToolResultMessage => message.role === 'toolResult',
    );
}