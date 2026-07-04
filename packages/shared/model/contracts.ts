import type { ProviderId } from '../provider/contracts';

export type ModelId = string;

export type ModelCapability =
  | 'chat'
  | 'streaming'
  | 'reasoning'
  | 'tool-calling'
  | 'json-mode';

export interface ModelDescriptor {
  id: ModelId;
  providerId: ProviderId;
  label: string;
  capabilities: ModelCapability[];
  contextWindowTokens?: number;
}

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  {
    id: 'deepseek-v4-flash',
    providerId: 'deepseek',
    label: 'DeepSeek V4 Flash',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'deepseek-v4-pro',
    providerId: 'deepseek',
    label: 'DeepSeek V4 Pro',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'gpt-5.5',
    providerId: 'openai',
    label: 'GPT-5.5',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_050_000,
  },
  {
    id: 'gpt-5.4',
    providerId: 'openai',
    label: 'GPT-5.4',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_050_000,
  },
  {
    id: 'gpt-5.4-mini',
    providerId: 'openai',
    label: 'GPT-5.4 Mini',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 400_000,
  },
  {
    id: 'gpt-5.4-nano',
    providerId: 'openai',
    label: 'GPT-5.4 Nano',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling', 'json-mode'],
    contextWindowTokens: 400_000,
  },
  {
    id: 'gpt-4.1',
    providerId: 'openai',
    label: 'GPT-4.1',
    capabilities: ['chat', 'streaming', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'gpt-4.1-mini',
    providerId: 'openai',
    label: 'GPT-4.1 Mini',
    capabilities: ['chat', 'streaming', 'tool-calling', 'json-mode'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'claude-opus-4-7',
    providerId: 'anthropic',
    label: 'Claude Opus 4.7',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    label: 'Claude Sonnet 4.6',
    capabilities: ['chat', 'streaming', 'reasoning', 'tool-calling'],
    contextWindowTokens: 1_000_000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    providerId: 'anthropic',
    label: 'Claude Haiku 4.5',
    capabilities: ['chat', 'streaming'],
    contextWindowTokens: 200_000,
  },
];

export function getModelsForProvider(providerId: ProviderId): ModelDescriptor[] {
  return MODEL_CATALOG.filter((model) => model.providerId === providerId);
}

