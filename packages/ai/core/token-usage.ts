import { z } from 'zod';

export const TokenUsageSchema = z
    .object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        cacheRead: z.number().int().nonnegative().optional(),
        cacheWrite: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
    })
    .strict();

export type TokenUsage = z.infer<typeof TokenUsageSchema>;