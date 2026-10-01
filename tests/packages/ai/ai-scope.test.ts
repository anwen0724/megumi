/*
 * Protects the trimmed provider and adapter scope of the AI package: only the
 * Megumi-supported providers, API adapters, package exports and generated
 * model catalog entries may be exposed.
 */

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { builtinModels, builtinProviders, getBuiltinProviders } from '@megumi/ai/providers/all';

const EXPECTED_PROVIDERS = [
  'anthropic',
  'deepseek',
  'google',
  'huggingface',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'openai',
  'openai-codex',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
];

describe('AI package trimmed scope', () => {
  it('registers exactly the supported built-in providers', () => {
    expect(getBuiltinProviders().sort()).toEqual([...EXPECTED_PROVIDERS].sort());
    const ids = builtinProviders()
      .map((provider) => provider.id)
      .sort();
    expect(ids).toEqual([...EXPECTED_PROVIDERS].sort());
  });

  it('builds a Models collection with only the supported providers', () => {
    const models = builtinModels();
    const ids = models
      .getProviders()
      .map((provider) => provider.id)
      .sort();
    expect(ids).toEqual([...EXPECTED_PROVIDERS].sort());
    const catalogProviders = new Set(getBuiltinProviders()) as Set<string>;
    for (const model of models.getModels()) {
      expect(catalogProviders.has(model.provider)).toBe(true);
    }
  });
});
