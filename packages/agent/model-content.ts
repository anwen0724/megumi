/*
 * Defines provider-neutral product content before Context materializes it into
 * the narrower message content accepted by packages/ai.
 */
import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from './shared-json';

export const TextContentBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).strict();
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;

export const JsonContentBlockSchema = z.object({
  type: z.literal('json'),
  value: JsonValueSchema,
}).strict();
export type JsonContentBlock = z.infer<typeof JsonContentBlockSchema>;

export const HostReferenceImageSourceSchema = z.object({
  type: z.literal('host_reference'),
  referenceId: z.string().min(1),
}).strict();
export const Base64ImageSourceSchema = z.object({
  type: z.literal('base64'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  data: z.string().min(1),
}).strict();
export const ImageSourceSchema = z.discriminatedUnion('type', [
  HostReferenceImageSourceSchema,
  Base64ImageSourceSchema,
]);
export type ImageSource = z.infer<typeof ImageSourceSchema>;
export const ImageContentBlockSchema = z.object({
  type: z.literal('image'),
  source: ImageSourceSchema,
}).strict();
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;

export const FileContentBlockSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
}).strict();
export type FileContentBlock = z.infer<typeof FileContentBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  JsonContentBlockSchema,
  ImageContentBlockSchema,
  FileContentBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export const ContentBlockListSchema = z.array(ContentBlockSchema);

export const ThinkingContentBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
}).strict();
export type ThinkingContentBlock = z.infer<typeof ThinkingContentBlockSchema>;
export const ToolCallContentBlockSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  name: z.string().min(1),
  argumentsText: z.string(),
}).strict();
export type ToolCallContentBlock = z.infer<typeof ToolCallContentBlockSchema>;
export const AssistantContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ThinkingContentBlockSchema,
  ToolCallContentBlockSchema,
]);
export type AssistantContentBlock = z.infer<typeof AssistantContentBlockSchema>;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encodes bytes without depending on a Node- or browser-specific global. */
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
