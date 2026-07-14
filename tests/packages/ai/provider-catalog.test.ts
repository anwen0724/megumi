/* Verifies the AI package's read-only provider and model catalog. */
import { describe, expect, it } from 'vitest';
import {
  getAiModelDefinition,
  getAiProviderDefinition,
  listAiProviderDefinitions,
} from '@megumi/ai';

describe('AI Provider Catalog', () => {
  it('defines the supported DeepSeek provider and current model capacities', () => {
    expect(getAiProviderDefinition('deepseek')).toMatchObject({
      providerId: 'DeepSeek',
      protocol: 'openai-compatible',
      defaultBaseUrl: 'https://api.deepseek.com',
    });
    expect(getAiModelDefinition('DeepSeek', 'deepseek-v4-flash')).toMatchObject({
      contextWindowTokens: 1_000_000,
      capabilities: { streaming: true, toolCalls: true, thinking: true },
    });
  });

  it('defines OpenAI with official API defaults and model capacities', () => {
    expect(getAiProviderDefinition('openai')).toMatchObject({
      providerId: 'OpenAI',
      protocol: 'openai-compatible',
      defaultBaseUrl: 'https://api.openai.com/v1',
    });
    expect(getAiModelDefinition('OpenAI', 'gpt-5.6')).toMatchObject({
      contextWindowTokens: 1_050_000,
      capabilities: { streaming: true, toolCalls: true, thinking: true },
    });
    expect(getAiModelDefinition('OpenAI', 'gpt-5.5')).toMatchObject({
      contextWindowTokens: 1_050_000,
      capabilities: { streaming: true, toolCalls: true, thinking: true },
    });
  });

  it('returns copies instead of exposing mutable catalog state', () => {
    const first = listAiProviderDefinitions();
    first[0].models.length = 0;
    expect(listAiProviderDefinitions()[0].models.length).toBeGreaterThan(0);
  });
});
