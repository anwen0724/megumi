/* Protects custom Settings models as first-class AI Provider runtimes without catalog membership. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveModelRuntime } from '@megumi/agent/agent-run/adapters/model-runtime-resolver';

describe('Model runtime resolver', () => {
  it('constructs an arbitrary custom provider and model from resolved Settings', () => {
    const runtime = resolveModelRuntime({
      provider_id: 'my-openai-proxy',
      api: 'openai-completions',
      base_url: 'https://llm.example.test/v1',
      model_id: 'gpt-custom',
      display_name: 'GPT Custom',
      context_window_tokens: 200_000,
      max_output_tokens: 16_000,
      capabilities: { streaming: true, toolCalls: true, thinking: false, imageInput: true },
      api_key: 'secret',
    });

    expect(runtime.provider).toMatchObject({
      id: 'my-openai-proxy',
      baseUrl: 'https://llm.example.test/v1',
    });
    expect(runtime.model).toMatchObject({
      id: 'gpt-custom',
      name: 'GPT Custom',
      provider: 'my-openai-proxy',
      api: 'openai-completions',
      baseUrl: 'https://llm.example.test/v1',
      contextWindow: 200_000,
      maxTokens: 16_000,
      input: ['text', 'image'],
    });
    expect(runtime.provider.getModels()).toEqual([runtime.model]);
  });

  it('attempts image input unless Settings explicitly marks the model as text-only', () => {
    const base = {
      provider_id: 'custom',
      api: 'openai-completions' as const,
      base_url: 'https://llm.example.test/v1',
      model_id: 'custom-model',
      display_name: 'Custom model',
      context_window_tokens: 128_000,
      max_output_tokens: 8_192,
      api_key: 'secret',
    };
    const unknown = resolveModelRuntime({
      ...base,
      capabilities: { streaming: 'unknown', toolCalls: 'unknown', thinking: 'unknown', imageInput: 'unknown' },
    });
    const unsupported = resolveModelRuntime({
      ...base,
      capabilities: { streaming: true, toolCalls: true, thinking: false, imageInput: false },
    });

    expect(unknown.model.input).toEqual(['text', 'image']);
    expect(unsupported.model.input).toEqual(['text']);
  });
});
