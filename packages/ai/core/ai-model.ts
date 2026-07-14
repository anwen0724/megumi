import { z } from 'zod';

export const AiModelCapabilitiesSchema = z
    .object({
        streaming: z.boolean().optional(),
        toolCalls: z.boolean().optional(),
        thinking: z.boolean().optional(),
        imageInput: z.boolean().optional(),
    })
    .strict();

export type AiModelCapabilities = z.infer<typeof AiModelCapabilitiesSchema>;

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
