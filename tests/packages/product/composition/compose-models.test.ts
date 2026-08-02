// @vitest-environment node
import {
  AssistantMessageEventStream,
  InMemoryCredentialStore,
  type ProviderStreams,
} from '@megumi/ai';
import { builtinProviders } from '@megumi/ai/providers/all';
import { composeModels, type ProductModelConfig } from '../../../../packages/product/src/models';
import { describe, expect, it } from 'vitest';

describe('Product Models composition', () => {
  it('uses the matching built-in provider and returns a credential-free Model', async () => {
    const openai = builtinProviders().find((provider) => provider.id === 'openai');
    const builtin = openai?.getModels()[0];
    expect(openai).toBeDefined();
    expect(builtin).toBeDefined();
    if (!openai || !builtin) return;
    const api: ProductModelConfig['api'] = 'openai-responses';
    expect(builtin.api).toBe(api);

    const composition = composeModels();
    const model = await composition.resolveModel(config({
      provider_id: openai.id,
      model_id: builtin.id,
      api,
      base_url: builtin.baseUrl,
      display_name: 'Configured OpenAI model',
    }));

    expect(composition.models.getProvider(openai.id)?.name).toBe(openai.name);
    expect(model).toMatchObject({
      provider: openai.id,
      id: builtin.id,
      api: builtin.api,
      baseUrl: builtin.baseUrl,
      name: 'Configured OpenAI model',
    });
  });

  it('registers a custom provider and model for a configured API and base URL', async () => {
    const composition = composeModels();
    const model = await composition.resolveModel(config({
      provider_id: 'acme',
      model_id: 'acme-reasoner',
      api: 'openai-completions',
      base_url: 'https://models.acme.test/v1',
      display_name: 'Acme Reasoner',
    }));

    expect(composition.models.getProvider('acme')).toMatchObject({
      id: 'acme',
      baseUrl: 'https://models.acme.test/v1',
    });
    expect(composition.models.getModel('acme', 'acme-reasoner')).toEqual(model);
    expect(model).toMatchObject({
      provider: 'acme',
      id: 'acme-reasoner',
      api: 'openai-completions',
      baseUrl: 'https://models.acme.test/v1',
    });
  });

  it('updates the provider credential without copying either secret into the resolved Model', async () => {
    const credentials = new InMemoryCredentialStore();
    const firstSecret = 'first-secret';
    const secondSecret = 'second-secret';
    await credentials.modify('custom-provider', async () => ({ type: 'api_key', key: firstSecret }));
    const composition = composeModels({ credentials });
    const first = await composition.resolveModel(config());
    expect((await composition.models.getAuth(first))?.auth.apiKey).toBe(firstSecret);
    await credentials.modify('custom-provider', async () => ({ type: 'api_key', key: secondSecret }));
    const second = await composition.resolveModel(config());

    expect((await composition.models.getAuth(second))?.auth.apiKey).toBe(secondSecret);
    expect(JSON.stringify({ first, second })).not.toContain(firstSecret);
    expect(JSON.stringify({ first, second })).not.toContain(secondSecret);
  });

  it('accepts a host-provided API implementation without requiring provider credentials', async () => {
    const streams: ProviderStreams = {
      stream: () => new AssistantMessageEventStream(),
      streamSimple: () => new AssistantMessageEventStream(),
    };
    const composition = composeModels({
      apiImplementations: { 'openai-responses': streams },
    });

    const model = await composition.resolveModel(config());

    expect(model).toMatchObject({
      provider: 'custom-provider',
      id: 'custom-model',
      api: 'openai-responses',
    });
    await expect(composition.models.getAuth(model)).resolves.toMatchObject({
      auth: {},
      source: 'injected model streams',
    });
  });
});

function config(overrides: Partial<ProductModelConfig> = {}): ProductModelConfig {
  return {
    provider_id: 'custom-provider',
    api: 'openai-responses',
    base_url: 'https://custom-provider.test/v1',
    model_id: 'custom-model',
    display_name: 'Custom Model',
    context_window_tokens: 128_000,
    max_output_tokens: 8_192,
    capabilities: {
      streaming: true,
      toolCalls: true,
      thinking: false,
      imageInput: true,
    },
    ...overrides,
  };
}
