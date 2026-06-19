// Defines command-owned facts and handoff contracts without executing commands or tools.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';

export const CommandKindSchema = z.enum(['agent_command', 'prompt_template', 'skill_trigger', 'app_operation', 'system', 'quick']);
export type CommandKind = z.infer<typeof CommandKindSchema>;

export const CommandSourceSchema = z.enum(['core', 'project', 'plugin', 'skill', 'system']);
export type CommandSource = z.infer<typeof CommandSourceSchema>;

export const PromptTemplateSourceSchema = z.enum(['builtin', 'project', 'plugin', 'skill']);
export type PromptTemplateSource = z.infer<typeof PromptTemplateSourceSchema>;

export const SkillSourceSchema = z.enum(['builtin', 'project', 'plugin']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const JsonSchemaSchema = JsonObjectSchema;
export type JsonSchema = JsonObject;

export type CommandDispatchTarget =
  | {
      kind: 'agent_command';
      commandName: string;
      description?: string;
    }
  | {
      kind: 'prompt_template';
      templateId: string;
      variables?: string[];
    }
  | {
      kind: 'skill_trigger';
      skillName: string;
      inputMode?: 'append_args' | 'replace_input';
    }
  | {
      kind: 'app_operation';
      operation: string;
      payloadSchema?: JsonSchema;
    };

export const CommandDispatchTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent_command'),
    commandName: z.string().min(1),
    description: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('prompt_template'),
    templateId: z.string().min(1),
    variables: z.array(z.string().min(1)).optional(),
  }).strict(),
  z.object({
    kind: z.literal('skill_trigger'),
    skillName: z.string().min(1),
    inputMode: z.enum(['append_args', 'replace_input']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('app_operation'),
    operation: z.string().min(1),
    payloadSchema: JsonSchemaSchema.optional(),
  }).strict(),
]);

export interface CommandDefinition {
  name: string;
  kind: CommandKind;
  source: CommandSource;
  description: string;
  argumentHint?: string;
  argumentSchema?: JsonObject;
  dispatch: CommandDispatchTarget;
  metadata?: JsonObject;
}

export const CommandDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    kind: CommandKindSchema,
    source: CommandSourceSchema,
    description: z.string().min(1),
    argumentHint: z.string().min(1).optional(),
    argumentSchema: JsonObjectSchema.optional(),
    dispatch: CommandDispatchTargetSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type ParsedSlashCommand = {
  rawText: string;
  name: string;
  argsText: string;
};

export type CommandDispatchResult =
  | {
      kind: 'fallback';
      rawText: string;
      reason: 'not_a_command' | 'unknown_command';
      parsedCommand?: ParsedSlashCommand;
    }
    | {
      kind: CommandDispatchTarget['kind'];
      command: CommandDefinition;
      commandName: string;
      rawText: string;
      argsText: string;
      target: CommandDispatchTarget;
    };

export interface CommandAuditFact {
  commandName: string;
  rawText: string;
  argsText: string;
  resultKind: CommandDispatchResult['kind'];
  fallback: boolean;
  unknown: boolean;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}
