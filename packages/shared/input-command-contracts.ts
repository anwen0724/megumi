import { z } from 'zod';
import { JsonObjectSchema } from './json';
import { PermissionModeSchema } from './permission-mode-contracts';

export const INPUT_COMMAND_KINDS = ['local', 'intent', 'extension', 'prompt_template', 'skill'] as const;
export const INPUT_COMMAND_SOURCES = ['core', 'extension', 'user', 'project'] as const;
export const INPUT_PROMPT_SOURCES = ['fallback', 'prompt_template', 'skill', 'extension_transform'] as const;
export const INPUT_INTENT_SOURCES = ['core_command'] as const;
export const INPUT_INTENTS = ['code_review'] as const;

export const InputCommandKindSchema = z.enum(INPUT_COMMAND_KINDS);
export const InputCommandSourceSchema = z.enum(INPUT_COMMAND_SOURCES);
export const InputPromptSourceSchema = z.enum(INPUT_PROMPT_SOURCES);
export const InputIntentSourceSchema = z.enum(INPUT_INTENT_SOURCES);
export const InputIntentNameSchema = z.enum(INPUT_INTENTS);

export const InputCommandDefinitionSchema = z
  .object({
    name: z.string().min(1),
    kind: InputCommandKindSchema,
    source: InputCommandSourceSchema,
    description: z.string().min(1),
    argumentHint: z.string().min(1).optional(),
  })
  .strict();

export const InputCommandSuggestionSchema = InputCommandDefinitionSchema;

export const InputIntentCommandMetadataSchema = z
  .object({
    intentName: InputIntentNameSchema,
    source: InputIntentSourceSchema,
    commandName: z.string().min(1),
    argsText: z.string(),
  })
  .strict();

export const DefaultInputPermissionSchema = z
  .object({
    permissionMode: PermissionModeSchema,
    source: z.literal('intent_default'),
  })
  .strict();

export const InputPipelineHandoffSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local_action'),
      commandName: z.string().min(1),
      argsText: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('send_prompt'),
      messageText: z.string(),
      source: InputPromptSourceSchema,
      metadata: JsonObjectSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('send_intent'),
      messageText: z.string(),
      intent: InputIntentCommandMetadataSchema,
      defaultPermission: DefaultInputPermissionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('handled'),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const InputInterceptResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pass') }).strict(),
  z
    .object({
      kind: z.literal('transform'),
      text: z.string(),
      metadata: JsonObjectSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('handled'),
      reason: z.string().min(1),
    })
    .strict(),
]);

export type InputCommandKind = z.infer<typeof InputCommandKindSchema>;
export type InputCommandSource = z.infer<typeof InputCommandSourceSchema>;
export type InputPromptSource = z.infer<typeof InputPromptSourceSchema>;
export type InputIntentSource = z.infer<typeof InputIntentSourceSchema>;
export type InputIntentName = z.infer<typeof InputIntentNameSchema>;
export type InputCommandDefinition = z.infer<typeof InputCommandDefinitionSchema>;
export type InputCommandSuggestion = z.infer<typeof InputCommandSuggestionSchema>;
export type InputIntentCommandMetadata = z.infer<typeof InputIntentCommandMetadataSchema>;
export type DefaultInputPermission = z.infer<typeof DefaultInputPermissionSchema>;
export type InputPipelineHandoff = z.infer<typeof InputPipelineHandoffSchema>;
export type InputInterceptResult = z.infer<typeof InputInterceptResultSchema>;

export function createCodeReviewInputIntentMetadata(argsText: string): InputIntentCommandMetadata {
  return {
    intentName: 'code_review',
    source: 'core_command',
    commandName: 'review',
    argsText: argsText.trim(),
  };
}
