// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ProviderRuntimeConfig } from '@megumi/ai/types';
import {
  ModelStepProviderService,
  type ModelStepProviderRegistryPort,
  type ModelStepRuntimeResolverPort,
} from '@megumi/desktop/main/services/model-step-provider.service';
import { ProviderRuntimeResolutionError } from '@megumi/desktop/main/services/provider-runtime.service';

const runtimeContext = {
  requestId: 'request-1',
  traceId: 'trace-model-step-1',
  debugId: 'debug-model-step-1',
  operationName: 'session.message.send',
  source: 'main',
  createdAt: '2026-05-17T00:00:00.000Z',
} as const;

function inputContext(): ModelInputContext {
  return {
    contextId: 'model-input-context:request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    parts: [
      {
        partId: 'part:current-turn:message-1',
        kind: 'current_turn',
        role: 'user',
        text: 'Hello',
        sourceRefs: [{
          sourceId: 'session-message:message-1',
          sourceKind: 'current_user_message',
        }],
        priority: 95,
        budgetStatus: 'included_full',
      },
    ],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 4096,
      inputTokenEstimate: 1,
      partBudgets: [{
        partId: 'part:current-turn:message-1',
        tokenEstimate: 1,
        budgetStatus: 'included_full',
      }],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [{
        sourceId: 'session-message:message-1',
        reason: 'current_turn',
      }],
      excludedSources: [],
    },
    builtAt: '2026-05-17T00:00:00.000Z',
  };
}

const request: ModelStepRuntimeRequest = {
  requestId: 'request-1',
  sessionId: 'session-1',
  runId: 'run-1',
  stepId: 'step-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-17T00:00:00.000Z',
  runtimeContext,
  inputContext: inputContext(),
};

const config: ProviderRuntimeConfig = {
  providerId: 'deepseek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-deepseek',
  defaultModelId: 'deepseek-v4-flash',
};

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

describe('ModelStepProviderService', () => {
  it('resolves runtime config and streams model steps through the selected adapter', async () => {
    const resolver: ModelStepRuntimeResolverPort = {
      resolveProviderRuntimeConfig: async (input) => {
        expect(input).toEqual({
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          runtimeContext,
        });
        return config;
      },
    };

    const registry: ModelStepProviderRegistryPort = {
      getAdapter: () => ({
        providerId: 'deepseek',
        async *streamModelStep(input) {
          expect(input.config).toBe(config);
          expect(input.request).toBe(request);
          expect(input.runId).toBe('run-1');
          expect(input.stepId).toBe('step-1');

          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.delta',
            sessionId: 'session-1',
            runId: 'run-1',
            stepId: 'step-1',
            requestId: 'request-1',
            context: runtimeContext,
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:02.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'transient',
            payload: { delta: 'Hello' },
          } satisfies RuntimeEvent;
          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.completed',
            sessionId: 'session-1',
            runId: 'run-1',
            stepId: 'step-1',
            requestId: 'request-1',
            context: runtimeContext,
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:03.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'required',
            payload: { content: 'Hello' },
          } satisfies RuntimeEvent;
        },
      }),
    };

    const service = new ModelStepProviderService({ resolver, registry });

    const events = await collect(service.streamModelStep(request));

    expect(events.map((event) => event.eventType)).toEqual([
      'assistant.output.delta',
      'assistant.output.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('maps runtime resolution errors to failed stream events', async () => {
    const resolver: ModelStepRuntimeResolverPort = {
      async resolveProviderRuntimeConfig() {
        throw new ProviderRuntimeResolutionError({
          code: 'provider_missing_api_key',
          message: 'Provider API key is missing.',
          severity: 'error',
          retryable: false,
          source: 'provider',
          details: {
            providerId: 'deepseek',
            modelId: 'deepseek-v4-flash',
          },
        });
      },
    };
    const registry: ModelStepProviderRegistryPort = {
      getAdapter() {
        throw new Error('Adapter should not be called');
      },
    };
    const service = new ModelStepProviderService({ resolver, registry });

    await expect(collect(service.streamModelStep(request))).resolves.toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          error: expect.objectContaining({
            code: 'provider_missing_api_key',
            message: 'Provider API key is missing.',
            retryable: false,
            source: 'provider',
            details: {
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
            },
          }),
        },
      }),
    ]);
  });

  it('does not expose raw generic error causes in failed stream events', async () => {
    const resolver: ModelStepRuntimeResolverPort = {
      async resolveProviderRuntimeConfig() {
        throw new Error('unexpected provider setup failed with sk-secret-raw-header');
      },
    };
    const registry: ModelStepProviderRegistryPort = {
      getAdapter() {
        throw new Error('Adapter should not be called');
      },
    };
    const service = new ModelStepProviderService({ resolver, registry });

    const events = await collect(service.streamModelStep(request));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          error: expect.objectContaining({
            code: 'runtime_unknown',
            message: 'Model step provider service failed.',
            retryable: true,
            source: 'main',
            debugId: 'debug-model-step-1',
            details: {
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
            },
          }),
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('sk-secret-raw-header');
    expect(JSON.stringify(events)).not.toContain('cause');
  });

  it('keeps failure event sequence monotonic when an adapter throws after streaming starts', async () => {
    const resolver: ModelStepRuntimeResolverPort = {
      resolveProviderRuntimeConfig: async () => config,
    };
    const registry: ModelStepProviderRegistryPort = {
      getAdapter: () => ({
        providerId: 'deepseek',
        async *streamModelStep(input) {
          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.delta',
            sessionId: 'session-1',
            runId: 'run-1',
            stepId: 'step-1',
            requestId: 'request-1',
            context: runtimeContext,
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:02.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'transient',
            payload: { delta: 'Hello' },
          } satisfies RuntimeEvent;

          throw new Error('unexpected provider stream failure');
        },
      }),
    };
    const service = new ModelStepProviderService({ resolver, registry });

    const events = await collect(service.streamModelStep(request));

    expect(events.map((event) => event.eventType)).toEqual([
      'assistant.output.delta',
      'run.failed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('cancels active model step requests by request id', async () => {
    let capturedSignal: AbortSignal | undefined;
    const resolver: ModelStepRuntimeResolverPort = {
      resolveProviderRuntimeConfig: async () => config,
    };
    const registry: ModelStepProviderRegistryPort = {
      getAdapter: () => ({
        providerId: 'deepseek',
        async *streamModelStep(input): AsyncIterable<RuntimeEvent> {
          capturedSignal = input.signal;
          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.delta',
            sessionId: 'session-1',
            runId: 'run-1',
            stepId: 'step-1',
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:02.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'transient',
            payload: { delta: 'partial' },
          } satisfies RuntimeEvent;
        },
      }),
    };
    const service = new ModelStepProviderService({ resolver, registry });
    const iterator = service.streamModelStep(request)[Symbol.asyncIterator]();

    await iterator.next();

    expect(service.cancelModelStep('request-1')).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
  });
});
