// Defines cross-boundary Prompt Template invocation metadata without implementing template loading.
import { z } from 'zod';
import { JsonObjectSchema } from '../primitives/json';

export const PROMPT_TEMPLATE_SOURCES = ['builtin', 'user', 'project'] as const;
export const PromptTemplateSourceSchema = z.enum(PROMPT_TEMPLATE_SOURCES);

export const PromptTemplateInvocationMetadataSchema = z
  .object({
    templateId: z.string().min(1),
    templateSource: PromptTemplateSourceSchema,
    commandName: z.string().min(1),
    argsText: z.string(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type PromptTemplateSource = z.infer<typeof PromptTemplateSourceSchema>;
export type PromptTemplateInvocationMetadata = z.infer<typeof PromptTemplateInvocationMetadataSchema>;
