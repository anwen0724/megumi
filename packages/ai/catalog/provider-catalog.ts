/*
 * Defines Megumi's read-only catalog of AI providers and their known models.
 * Product configuration may copy and override these definitions, but this
 * package never reads Settings or owns configured provider instances.
 */
import { z } from 'zod';
import { AiModelCapabilitiesSchema, AiProtocolSchema } from '../core/ai-model';

export const AiModelDefinitionSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  contextWindowTokens: z.number().int().positive(),
  capabilities: AiModelCapabilitiesSchema,
}).strict();
export type AiModelDefinition = z.infer<typeof AiModelDefinitionSchema>;

export const AiProviderDefinitionSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  protocol: AiProtocolSchema,
  defaultBaseUrl: z.string().url(),
  models: z.array(AiModelDefinitionSchema).min(1),
}).strict();
export type AiProviderDefinition = z.infer<typeof AiProviderDefinitionSchema>;

const PROVIDERS = AiProviderDefinitionSchema.array().parse([
  {
    providerId: 'DeepSeek',
    displayName: 'DeepSeek',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    models: [
      {
        modelId: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        contextWindowTokens: 1_000_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
      {
        modelId: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        contextWindowTokens: 1_000_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
    ],
  },
  {
    providerId: 'OpenAI',
    displayName: 'OpenAI',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      {
        modelId: 'gpt-5.6',
        displayName: 'GPT-5.6',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
      {
        modelId: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
      {
        modelId: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
      {
        modelId: 'gpt-5.5',
        displayName: 'GPT-5.5',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
      {
        modelId: 'gpt-5.5-pro',
        displayName: 'GPT-5.5 Pro',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
    ],
  },
] satisfies AiProviderDefinition[]);

export function listAiProviderDefinitions(): AiProviderDefinition[] {
  return structuredClone(PROVIDERS);
}

export function getAiProviderDefinition(providerId: string): AiProviderDefinition | undefined {
  const normalized = providerId.trim().toLowerCase();
  const provider = PROVIDERS.find((candidate) => candidate.providerId.toLowerCase() === normalized);
  return provider ? structuredClone(provider) : undefined;
}

export function getAiModelDefinition(
  providerId: string,
  modelId: string,
): AiModelDefinition | undefined {
  const provider = getAiProviderDefinition(providerId);
  const normalized = modelId.trim().toLowerCase();
  return provider?.models.find((model) => model.modelId.toLowerCase() === normalized);
}
