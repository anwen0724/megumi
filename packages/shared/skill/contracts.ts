// Defines cross-boundary Skill invocation metadata without implementing skill loading.
import { z } from 'zod';
import { JsonObjectSchema } from '../primitives/json';

export const SKILL_SOURCES = ['builtin', 'user', 'project'] as const;
export const SkillSourceSchema = z.enum(SKILL_SOURCES);

export const SkillInvocationMetadataSchema = z
  .object({
    skillId: z.string().min(1),
    skillSource: SkillSourceSchema,
    commandName: z.string().min(1),
    argsText: z.string(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type SkillSource = z.infer<typeof SkillSourceSchema>;
export type SkillInvocationMetadata = z.infer<typeof SkillInvocationMetadataSchema>;
