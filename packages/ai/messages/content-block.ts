import { z } from 'zod';

export const TextContentBlockSchema = z
    .object({
        type: z.literal('text'),
        text: z.string(),
    })
    .strict();

export interface TextContentBlock {
    type: 'text';
    text: string;
}

export const ThinkingContentBlockSchema = z
    .object({
        type: z.literal('thinking'),
        thinking: z.string(),
    })
    .strict();

export interface ThinkingContentBlock {
    type: 'thinking';
    thinking: string;
}

export const ToolCallContentBlockSchema = z
    .object({
        type: z.literal('toolCall'),
        id: z.string().min(1),
        name: z.string().min(1),
        argumentsText: z.string(),
    })
    .strict();

export interface ToolCallContentBlock {
    type: 'toolCall';
    id: string;
    name: string;
    argumentsText: string;
}

export const AssistantContentBlockSchema = z.discriminatedUnion('type', [
    TextContentBlockSchema,
    ThinkingContentBlockSchema,
    ToolCallContentBlockSchema,
]);

export type AssistantContentBlock =
    | TextContentBlock
    | ThinkingContentBlock
    | ToolCallContentBlock;