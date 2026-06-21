// Defines provider-neutral model identity for the src AI module.
import { z } from 'zod';

export const ModelCapabilitiesSchema = z
  .object({
    streaming: z.boolean().optional(),
    toolCalls: z.boolean().optional(),
    thinking: z.boolean().optional(),
  })
  .strict();

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelSchema = z
  .object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    capabilities: ModelCapabilitiesSchema.optional(),
  })
  .strict();

export type Model = z.infer<typeof ModelSchema>;

export function defineModel(model: Model): Model {
  return ModelSchema.parse(model);
}
