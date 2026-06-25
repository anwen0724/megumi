// Defines parsed input facts consumed by later command, context, and runtime boundaries.
import { z } from 'zod';
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

export const ParsedInputKindSchema = z.enum(['user_input', 'command_input', 'skill_input', 'app_operation']);
export type ParsedInputKind = z.infer<typeof ParsedInputKindSchema>;

export type CommandInputFact = {
  kind: 'command';
  commandName: string;
  argsText: string;
  rawText: string;
  target: 'agent_command';
};

export type PromptTemplateInputFact = {
  kind: 'prompt_template';
  commandName: string;
  argsText: string;
  templateId?: string;
};

export type SkillInputFact = {
  kind: 'skill';
  skillName: string;
  argsText: string;
  source: 'command' | 'explicit_entry';
};

export type AppOperationInputFact = {
  kind: 'app_operation';
  operation: string;
  argsText: string;
  source: 'command' | 'shortcut';
};

export type ParsedInputFact =
  | CommandInputFact
  | PromptTemplateInputFact
  | SkillInputFact
  | AppOperationInputFact;

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
    commandName: z.string().min(1),
    argsText: z.string(),
    rawText: z.string().min(1),
    target: z.literal('agent_command'),
  })
  .strict();

export const PromptTemplateInputFactSchema = z
  .object({
    kind: z.literal('prompt_template'),
    commandName: z.string().min(1),
    argsText: z.string(),
    templateId: z.string().min(1).optional(),
  })
  .strict();

export const SkillInputFactSchema = z
  .object({
    kind: z.literal('skill'),
    skillName: z.string().min(1),
    argsText: z.string(),
    source: z.enum(['command', 'explicit_entry']),
  })
  .strict();

export const AppOperationInputFactSchema = z
  .object({
    kind: z.literal('app_operation'),
    operation: z.string().min(1),
    argsText: z.string(),
    source: z.enum(['command', 'shortcut']),
  })
  .strict();

export const ParsedInputFactSchema = z.discriminatedUnion('kind', [
  CommandInputFactSchema,
  PromptTemplateInputFactSchema,
  SkillInputFactSchema,
  AppOperationInputFactSchema,
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
