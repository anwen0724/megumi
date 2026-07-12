/*
 * Provider-neutral structured content and legacy assistant stream blocks.
 */
import { z } from 'zod';
import {
    JsonValueSchema,
    type JsonValue,
} from '../core/json';

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

export const JsonContentBlockSchema = z
    .object({
        type: z.literal('json'),
        value: JsonValueSchema,
    })
    .strict();

export interface JsonContentBlock {
    type: 'json';
    value: JsonValue;
}

export const HostReferenceImageSourceSchema = z
    .object({
        type: z.literal('host_reference'),
        referenceId: z.string().min(1),
    })
    .strict();

export const LocalFileImageSourceSchema = z
    .object({
        type: z.literal('local_file'),
        path: z.string().min(1),
    })
    .strict();

export const ImageSourceSchema = z.discriminatedUnion('type', [
    LocalFileImageSourceSchema,
    HostReferenceImageSourceSchema,
]);

export type ImageSource = z.infer<typeof ImageSourceSchema>;

export const ImageContentBlockSchema = z
    .object({
        type: z.literal('image'),
        source: ImageSourceSchema,
    })
    .strict();

export interface ImageContentBlock {
    type: 'image';
    source: ImageSource;
}

export const FileContentBlockSchema = z
    .object({
        type: z.literal('file'),
        fileId: z.string().min(1),
        name: z.string().min(1).optional(),
        mediaType: z.string().min(1).optional(),
    })
    .strict();

export interface FileContentBlock {
    type: 'file';
    fileId: string;
    name?: string;
    mediaType?: string;
}

export const ContentBlockSchema = z.discriminatedUnion('type', [
    TextContentBlockSchema,
    JsonContentBlockSchema,
    ImageContentBlockSchema,
    FileContentBlockSchema,
]);

export type ContentBlock =
    | TextContentBlock
    | JsonContentBlock
    | ImageContentBlock
    | FileContentBlock;

export const ContentBlockListSchema = z.array(ContentBlockSchema);

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
