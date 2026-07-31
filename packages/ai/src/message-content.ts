/*
 * Provider-neutral message content accepted at Megumi package boundaries.
 */
import { z } from "zod";
import { JsonValueSchema, type JsonValue } from "./json.ts";

export const TextContentBlockSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
}).strict();
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;

export const JsonContentBlockSchema = z.object({
	type: z.literal("json"),
	value: JsonValueSchema,
}).strict();
export type JsonContentBlock = z.infer<typeof JsonContentBlockSchema>;

export const HostReferenceImageSourceSchema = z.object({
	type: z.literal("host_reference"),
	referenceId: z.string().min(1),
}).strict();

export const Base64ImageSourceSchema = z.object({
	type: z.literal("base64"),
	mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
	data: z.string().min(1),
}).strict();

export const ImageSourceSchema = z.discriminatedUnion("type", [
	HostReferenceImageSourceSchema,
	Base64ImageSourceSchema,
]);
export type ImageSource = z.infer<typeof ImageSourceSchema>;

export const ImageContentBlockSchema = z.object({
	type: z.literal("image"),
	source: ImageSourceSchema,
}).strict();
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;

export const FileContentBlockSchema = z.object({
	type: z.literal("file"),
	path: z.string().min(1),
	name: z.string().min(1).optional(),
	mediaType: z.string().min(1).optional(),
}).strict();
export type FileContentBlock = z.infer<typeof FileContentBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion("type", [
	TextContentBlockSchema,
	JsonContentBlockSchema,
	ImageContentBlockSchema,
	FileContentBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export const ContentBlockListSchema = z.array(ContentBlockSchema);

export const ThinkingContentBlockSchema = z.object({
	type: z.literal("thinking"),
	thinking: z.string(),
}).strict();
export type ThinkingContentBlock = z.infer<typeof ThinkingContentBlockSchema>;

export const ToolCallContentBlockSchema = z.object({
	type: z.literal("toolCall"),
	id: z.string().min(1),
	name: z.string().min(1),
	argumentsText: z.string(),
}).strict();
export type ToolCallContentBlock = z.infer<typeof ToolCallContentBlockSchema>;

export const AssistantContentBlockSchema = z.discriminatedUnion("type", [
	TextContentBlockSchema,
	ThinkingContentBlockSchema,
	ToolCallContentBlockSchema,
]);
export type AssistantContentBlock = z.infer<typeof AssistantContentBlockSchema>;
