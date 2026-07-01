// Defines parsed input facts consumed by later command, context, and runtime boundaries.
import { z } from 'zod';
import type { CommandSource } from '../commands';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '@megumi/shared/primitives';
import type { ParsedInputId, RawInputId } from './ids';
import {
  InputAttachmentSchema,
  InputReferenceSchema,
  InputSourceSchema,
  InputTargetSchema,
  RawInputKindSchema,
  type InputAttachment,
  type InputReference,
  type InputSource,
  type InputTarget,
  type RawInputKind,
} from './raw-input';

export const ParsedInputKindSchema = z.enum(['user_input']);
export type ParsedInputKind = z.infer<typeof ParsedInputKindSchema>;

export type CommandInputFact = {
  kind: 'command';
  name: string;
  source: CommandSource;
  arguments_input: string;
  raw_input: string;
};

export type ParsedInputFact = CommandInputFact;

export interface ParsedInput {
  id: ParsedInputId | string;
  rawInputId: RawInputId | string;
  source: InputSource;
  rawKind: RawInputKind;
  kind: ParsedInputKind;
  text: string;
  attachments: InputAttachment[];
  references: InputReference[];
  target?: InputTarget;
  facts: ParsedInputFact[];
  metadata?: JsonObject;
  createdAt: IsoDateTime;
}

export const CommandInputFactSchema = z
  .object({
    kind: z.literal('command'),
    name: z.string().min(1),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('built_in') }).strict(),
      z.object({ kind: z.literal('skill'), skill_id: z.string().min(1) }).strict(),
    ]),
    arguments_input: z.string(),
    raw_input: z.string().min(1),
  })
  .strict();

export const ParsedInputFactSchema = z.discriminatedUnion('kind', [
  CommandInputFactSchema,
]);

export const ParsedInputSchema = z
  .object({
    id: z.string().min(1),
    rawInputId: z.string().min(1),
    source: InputSourceSchema,
    rawKind: RawInputKindSchema,
    kind: ParsedInputKindSchema,
    text: z.string(),
    attachments: z.array(InputAttachmentSchema),
    references: z.array(InputReferenceSchema),
    target: InputTargetSchema.optional(),
    facts: z.array(ParsedInputFactSchema),
    createdAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
