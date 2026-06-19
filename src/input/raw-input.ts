// Owns raw input facts before command dispatch, context construction, or Agent Run creation.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type { RawInputId } from './ids';

export const InputSourceKindSchema = z.enum(['composer', 'quick_action', 'system', 'desktop', 'app']);
export type InputSourceKind = z.infer<typeof InputSourceKindSchema>;

export const RawInputKindSchema = z.enum(['text', 'slash_command', 'attachment', 'reference', 'system']);
export type RawInputKind = z.infer<typeof RawInputKindSchema>;

export const InputSourceSchema = z
  .object({
    kind: InputSourceKindSchema,
    surface: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type InputSource = z.infer<typeof InputSourceSchema>;

export const InputAttachmentSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['file', 'image', 'document']),
    name: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type InputAttachment = z.infer<typeof InputAttachmentSchema>;

export const InputReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selected_file'), filePath: z.string().min(1), metadata: JsonObjectSchema.optional() }).strict(),
  z.object({
    kind: z.literal('selected_range'),
    filePath: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    metadata: JsonObjectSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal('artifact'), artifactId: z.string().min(1), metadata: JsonObjectSchema.optional() }).strict(),
]);
export type InputReference = z.infer<typeof InputReferenceSchema>;

export const InputTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: z.string().min(1), metadata: JsonObjectSchema.optional() }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1).optional(), metadata: JsonObjectSchema.optional() }).strict(),
  z.object({ kind: z.literal('file'), filePath: z.string().min(1), metadata: JsonObjectSchema.optional() }).strict(),
  z.object({ kind: z.literal('selection'), filePath: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive(), metadata: JsonObjectSchema.optional() }).strict(),
  z.object({ kind: z.literal('artifact'), artifactId: z.string().min(1), metadata: JsonObjectSchema.optional() }).strict(),
]);
export type InputTarget = z.infer<typeof InputTargetSchema>;

export const RawInputSchema = z
  .object({
    id: z.string().min(1),
    source: InputSourceSchema,
    kind: RawInputKindSchema.optional(),
    text: z.string().optional(),
    attachments: z.array(InputAttachmentSchema).optional(),
    references: z.array(InputReferenceSchema).optional(),
    target: InputTargetSchema.optional(),
    metadata: JsonObjectSchema.optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export interface RawInput {
  id: RawInputId | string;
  source: InputSource;
  kind?: RawInputKind;
  text?: string;
  attachments?: InputAttachment[];
  references?: InputReference[];
  target?: InputTarget;
  metadata?: JsonObject;
  createdAt: IsoDateTime;
}
