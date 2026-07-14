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

export const Base64ImageSourceSchema = z
    .object({
        type: z.literal('base64'),
        mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        data: z.string().min(1),
    })
    .strict();

export const ImageSourceSchema = z.discriminatedUnion('type', [
    HostReferenceImageSourceSchema,
    Base64ImageSourceSchema,
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

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encodes binary content without relying on a Node- or browser-specific global. */
export function encodeBase64(bytes: Uint8Array): string {
    let encoded = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1] ?? 0;
        const third = bytes[index + 2] ?? 0;
        const remaining = bytes.length - index;
        encoded += BASE64_ALPHABET[first >> 2];
        encoded += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)];
        encoded += remaining > 1 ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)] : '=';
        encoded += remaining > 2 ? BASE64_ALPHABET[third & 0b111111] : '=';
    }
    return encoded;
}

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
