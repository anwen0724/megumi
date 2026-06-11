// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  isProviderId,
  type ProviderId,
  type ProviderSettings,
  type SecretRef,
} from '@megumi/shared/provider';
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_CATALOG,
  getDefaultModelId,
  getModelsForProvider,
} from '@megumi/shared/model';

describe('provider contracts', () => {
  it('lists the supported phase 1 providers', () => {
    expect(PROVIDER_IDS).toEqual(['deepseek', 'openai', 'anthropic']);
    expect(isProviderId('deepseek')).toBe(true);
    expect(isProviderId('openai')).toBe(true);
    expect(isProviderId('anthropic')).toBe(true);
    expect(isProviderId('ollama')).toBe(false);
  });

  it('defines default settings without plaintext secrets', () => {
    const deepseek = DEFAULT_PROVIDER_SETTINGS.deepseek;

    expect(deepseek.providerId).toBe('deepseek');
    expect(deepseek.enabled).toBe(true);
    expect(deepseek.baseUrl).toBe('https://api.deepseek.com');
    expect(deepseek.defaultModelId).toBe(DEFAULT_MODEL_BY_PROVIDER.deepseek);
    expect(deepseek.secretRef).toBeUndefined();
    expect(JSON.stringify(DEFAULT_PROVIDER_SETTINGS)).not.toContain('apiKey');
  });

  it('supports secret references without exposing secret values', () => {
    const secretRef: SecretRef = {
      id: 'secret:provider-api-key:deepseek',
      providerId: 'deepseek',
      scope: 'provider-api-key',
    };

    const settings: ProviderSettings = {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      secretRef,
      updatedAt: '2026-05-11T00:00:00.000Z',
    };

    expect(settings.secretRef).toEqual(secretRef);
    expect(JSON.stringify(settings)).not.toContain('sk-');
  });
});

describe('model contracts', () => {
  it('exposes model catalog entries for each provider', () => {
    const providers = new Set<ProviderId>(MODEL_CATALOG.map((model) => model.providerId));

    expect(providers.has('deepseek')).toBe(true);
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('anthropic')).toBe(true);
  });

  it('filters models by provider', () => {
    expect(getModelsForProvider('deepseek').map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);

    expect(getModelsForProvider('openai').map((model) => model.id)).toContain('gpt-5.5');
    expect(getModelsForProvider('anthropic').map((model) => model.id)).toContain('claude-sonnet-4-6');
  });

  it('keeps current model context windows aligned with provider docs', () => {
    const contextWindows = new Map(MODEL_CATALOG.map((model) => [model.id, model.contextWindowTokens]));

    expect(contextWindows.get('deepseek-v4-flash')).toBe(1_000_000);
    expect(contextWindows.get('deepseek-v4-pro')).toBe(1_000_000);
    expect(contextWindows.get('gpt-5.5')).toBe(1_050_000);
    expect(contextWindows.get('gpt-5.4')).toBe(1_050_000);
    expect(contextWindows.get('gpt-5.4-mini')).toBe(400_000);
    expect(contextWindows.get('gpt-5.4-nano')).toBe(400_000);
    expect(contextWindows.get('claude-sonnet-4-6')).toBe(1_000_000);
  });

  it('returns default models for provider ids', () => {
    expect(getDefaultModelId('deepseek')).toBe('deepseek-v4-flash');
    expect(getDefaultModelId('openai')).toBe('gpt-5.5');
    expect(getDefaultModelId('anthropic')).toBe('claude-sonnet-4-6');
  });
});

