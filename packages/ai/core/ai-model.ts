import { z } from 'zod';

export const AiModelSupportLevelSchema = z.union([
    z.boolean(),
    z.literal('unknown'),
]);
export type AiModelSupportLevel = z.infer<typeof AiModelSupportLevelSchema>;

export const AiModelCapabilitiesSchema = z
    .object({
        streaming: AiModelSupportLevelSchema.optional(),
        toolCalls: AiModelSupportLevelSchema.optional(),
        thinking: AiModelSupportLevelSchema.optional(),
        imageInput: AiModelSupportLevelSchema.optional(),
    })
    .strict();

export type AiModelCapabilities = z.infer<typeof AiModelCapabilitiesSchema>;

export const AiModelResolvedCapabilitiesSchema = z
    .object({
        streaming: AiModelSupportLevelSchema,
        toolCalls: AiModelSupportLevelSchema,
        thinking: AiModelSupportLevelSchema,
        imageInput: AiModelSupportLevelSchema,
    })
    .strict();
export type AiModelResolvedCapabilities = z.infer<typeof AiModelResolvedCapabilitiesSchema>;

export const UNKNOWN_AI_MODEL_CAPABILITIES: AiModelResolvedCapabilities = Object.freeze({
    streaming: 'unknown',
    toolCalls: 'unknown',
    thinking: 'unknown',
    imageInput: 'unknown',
});

export const AiProtocolSchema = z.enum(['openai-compatible', 'anthropic']);
export type AiProtocol = z.infer<typeof AiProtocolSchema>;

export const AiModelSchema = z
    .object({
        providerId: z.string().min(1),
        protocol: AiProtocolSchema,
        modelId: z.string().min(1),
        baseUrl: z.string().url().optional(),
        displayName: z.string().min(1).optional(),
        capabilities: AiModelCapabilitiesSchema.optional(),
    })
    .strict();

export type AiModel = z.infer<typeof AiModelSchema>;

export function defineAiModel(model: AiModel): AiModel {
    return AiModelSchema.parse(model);
}
