// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import { createAiProviderRegistry } from '@megumi/ai/registry';
import type { FetchLike, ProviderRuntimeConfig } from '@megumi/ai/types';

const request: ModelStepRuntimeRequest = {
  requestId: 'request-1',
  sessionId: 'session-1',
  runId: 'run-1',
  stepId: 'step-1',
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  createdAt: '2026-05-11T00:00:00.000Z',
  inputContext: {
    contextId: 'model-input-context:request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    parts: [
      {
        partId: 'part:current-turn:1',
        kind: 'current_turn',
        role: 'user',
        text: 'Hello',
        sourceRefs: [{ sourceId: 'message-1', sourceKind: 'current_user_message' }],
        priority: 100,
        budgetStatus: 'included_full',
      },
    ],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      inputTokenEstimate: 1,
      partBudgets: [
        {
          partId: 'part:current-turn:1',
          tokenEstimate: 1,
          budgetStatus: 'included_full',
        },
      ],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [{ sourceId: 'message-1', reason: 'current_turn' }],
      excludedSources: [],
    },
    builtAt: '2026-05-11T00:00:00.000Z',
  },
};

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

describe('AI provider registry', () => {
  function adapterInput(config: ProviderRuntimeConfig) {
    let sequence = 0;

    return {
      request,
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      eventIdFactory: () => `event-${sequence + 1}`,
    };
  }

  it('registers DeepSeek, OpenAI, and Anthropic adapters', () => {
    const registry = createAiProviderRegistry({
      fetch: vi.fn<FetchLike>(),
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    expect(registry.listProviderIds()).toEqual(['deepseek', 'openai', 'anthropic']);
    expect(registry.getAdapter('deepseek').providerId).toBe('deepseek');
    expect(registry.getAdapter('openai').providerId).toBe('openai');
    expect(registry.getAdapter('anthropic').providerId).toBe('anthropic');
  });

  it('returns a clear unsupported event for Anthropic in phase 1', async () => {
    const registry = createAiProviderRegistry({
      fetch: vi.fn<FetchLike>(),
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const config: ProviderRuntimeConfig = {
      providerId: 'anthropic',
      kind: 'anthropic',
      apiKey: 'sk-ant',
      defaultModelId: 'claude-sonnet-4-6',
    };

    const events = await collect(registry.getAdapter('anthropic').streamModelStep(adapterInput(config)));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          error: {
            code: 'provider_unsupported',
            message: 'Anthropic provider is not implemented yet.',
            severity: 'warning',
            retryable: false,
            source: 'provider',
            details: {
              providerId: 'anthropic',
            },
          },
        },
      }),
    ]);
  });
});
