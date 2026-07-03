/*
 * Defines normalized input preprocessing results before runtime turns them into model context parts.
 */
import { z } from 'zod';
import { InputHookActionSchema } from '../../hooks/contracts/input-hook-contracts';
import { JsonObjectSchema } from '@megumi/shared/primitives/json';
import { PermissionModeSchema } from '@megumi/shared/permission/mode-contracts';
import { PromptTemplateSourceSchema } from '@megumi/shared/prompt-template/contracts';
import { SkillSourceSchema } from '@megumi/shared/skill/contracts';

export const INPUT_PREPROCESSING_ENTRY_KINDS = ['intent', 'prompt_template', 'skill', 'input_hook'] as const;
export const INPUT_PREPROCESSING_VISIBILITIES = ['model_visible', 'host_only'] as const;

export const InputPreprocessingEntryKindSchema = z.enum(INPUT_PREPROCESSING_ENTRY_KINDS);
export const InputPreprocessingVisibilitySchema = z.enum(INPUT_PREPROCESSING_VISIBILITIES);

const BaseInputPreprocessingEntrySchema = z
  .object({
    sourceId: z.string().min(1),
    sourceName: z.string().min(1),
    visibility: InputPreprocessingVisibilitySchema,
    instructionText: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

function requireInstructionForModelVisible(
  entry: { visibility: 'model_visible' | 'host_only'; instructionText?: string },
  context: z.RefinementCtx,
): void {
  if (entry.visibility === 'model_visible' && !entry.instructionText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Model-visible input preprocessing entries require instructionText.',
      path: ['instructionText'],
    });
  }
}

const IntentCommandEntryBaseSchema = BaseInputPreprocessingEntrySchema.extend({
  kind: z.literal('intent'),
  intentId: z.string().min(1),
  commandName: z.string().min(1),
  defaultPermissionMode: PermissionModeSchema.optional(),
  defaultPermissionSource: z.literal('intent_default').optional(),
}).strict();

const PromptTemplateEntryBaseSchema = BaseInputPreprocessingEntrySchema.extend({
  kind: z.literal('prompt_template'),
  templateId: z.string().min(1),
  commandName: z.string().min(1),
  templateSource: PromptTemplateSourceSchema,
}).strict();

const SkillCommandEntryBaseSchema = BaseInputPreprocessingEntrySchema.extend({
  kind: z.literal('skill'),
  skillId: z.string().min(1),
  commandName: z.string().min(1),
  skillSource: SkillSourceSchema,
}).strict();

const InputHookEntryBaseSchema = BaseInputPreprocessingEntrySchema.extend({
  kind: z.literal('input_hook'),
  hookId: z.string().min(1),
  action: InputHookActionSchema,
}).strict();

export const IntentCommandEntrySchema = IntentCommandEntryBaseSchema.superRefine(requireInstructionForModelVisible);
export const PromptTemplateEntrySchema = PromptTemplateEntryBaseSchema.superRefine(requireInstructionForModelVisible);
export const SkillCommandEntrySchema = SkillCommandEntryBaseSchema.superRefine(requireInstructionForModelVisible);
export const InputHookEntrySchema = InputHookEntryBaseSchema.superRefine(requireInstructionForModelVisible);

export const InputPreprocessingEntrySchema = z.discriminatedUnion('kind', [
  IntentCommandEntryBaseSchema,
  PromptTemplateEntryBaseSchema,
  SkillCommandEntryBaseSchema,
  InputHookEntryBaseSchema,
]).superRefine(requireInstructionForModelVisible);

export const InputPreprocessingDiagnosticSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export const InputPreprocessingResultSchema = z
  .object({
    originalText: z.string(),
    effectiveUserText: z.string(),
    entries: z.array(InputPreprocessingEntrySchema),
    diagnostics: z.array(InputPreprocessingDiagnosticSchema),
  })
  .strict();

export type InputPreprocessingEntryKind = z.infer<typeof InputPreprocessingEntryKindSchema>;
export type InputPreprocessingVisibility = z.infer<typeof InputPreprocessingVisibilitySchema>;
export type IntentCommandEntry = z.infer<typeof IntentCommandEntrySchema>;
export type PromptTemplateEntry = z.infer<typeof PromptTemplateEntrySchema>;
export type SkillCommandEntry = z.infer<typeof SkillCommandEntrySchema>;
export type InputHookEntry = z.infer<typeof InputHookEntrySchema>;
export type InputPreprocessingEntry = z.infer<typeof InputPreprocessingEntrySchema>;
export type InputPreprocessingDiagnostic = z.infer<typeof InputPreprocessingDiagnosticSchema>;
export type InputPreprocessingResult = z.infer<typeof InputPreprocessingResultSchema>;
