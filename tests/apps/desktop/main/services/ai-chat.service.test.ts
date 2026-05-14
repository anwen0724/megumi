// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createAssistantCompletedEvent,
  createAssistantDeltaEvent,
} from '@megumi/core/chat/events';
import type { ProviderRuntimeConfig } from '@megumi/ai/types';
import {
  AiChatService,
  type AiChatProviderRegistryPort,
  type AiChatRuntimeResolverPort,
} from '@megumi/desktop/main/services/ai-chat.service';
import { ProviderRuntimeResolutionError } from '@megumi/desktop/main/services/provider-runtime.service';

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-11T00:00:00.000Z',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Hello',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
  ],
};

const runtimeContext = {
  requestId: 'request-1',
  traceId: 'trace-chat-1',
  debugId: 'debug-chat-1',
  operationName: 'chat.start',
  source: 'main',
  createdAt: '2026-05-11T00:00:00.000Z',
} as const;

const requestWithRuntimeContext: ChatRuntimeRequest = {
  ...request,
  runtimeContext,
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

describe('AiChatService', () => {
  it('resolves runtime config and streams through the selected adapter', async () => {
    const resolver: AiChatRuntimeResolverPort = {
      resolveProviderRuntimeConfig: async (input) => {
        expect(input).toEqual({
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          runtimeContext,
        });
        return config;
      },
    };

    const registry: AiChatProviderRegistryPort = {
      getAdapter: () => ({
        providerId: 'deepseek',
        async *streamChat(input) {
          expect(input.config).toBe(config);
          expect(input.request).toBe(requestWithRuntimeContext);
          expect(input.runId).toBe('run-1');

          yield createAssistantDeltaEvent({
            eventId: input.eventIdFactory(),
            request: input.request,
            runId: 'run-1',
            sequence: input.nextSequence(),
            delta: 'Hello',
            createdAt: '2026-05-11T00:00:02.000Z',
          });
          yield createAssistantCompletedEvent({
            eventId: input.eventIdFactory(),
            request: input.request,
            runId: 'run-1',
            sequence: input.nextSequence(),
            createdAt: '2026-05-11T00:00:03.000Z',
            payload: {
              content: 'Hello',
            },
          });
        },
      }),
    };

    const service = new AiChatService({
      resolver,
      registry,
      runIdFactory: () => 'run-1',
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(service.streamChat(requestWithRuntimeContext));

    expect(events.map((event) => event.eventType)).toEqual([
      'run.started',
      'assistant.output.delta',
      'assistant.output.completed',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[0]).toMatchObject({
      eventType: 'run.started',
      requestId: 'request-1',
      runId: 'run-1',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    });
    expect(events.map((event) => event.context)).toEqual([
      runtimeContext,
      runtimeContext,
      runtimeContext,
      runtimeContext,
    ]);
  });

  it('maps runtime resolution errors to failed stream events', async () => {
    const resolver: AiChatRuntimeResolverPort = {
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

    const registry: AiChatProviderRegistryPort = {
      getAdapter() {
        throw new Error('Adapter should not be called');
      },
    };

    const service = new AiChatService({
      resolver,
      registry,
      runIdFactory: () => 'run-1',
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    await expect(collect(service.streamChat(request))).resolves.toEqual([
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
    const resolver: AiChatRuntimeResolverPort = {
      async resolveProviderRuntimeConfig() {
        throw new Error('unexpected provider setup failed with sk-secret-raw-header');
      },
    };

    const registry: AiChatProviderRegistryPort = {
      getAdapter() {
        throw new Error('Adapter should not be called');
      },
    };

    const service = new AiChatService({
      resolver,
      registry,
      runIdFactory: () => 'run-1',
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(service.streamChat({
      ...requestWithRuntimeContext,
      providerId: 'deepseek',
    }));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          error: expect.objectContaining({
            code: 'runtime_unknown',
            message: 'Chat service failed.',
            retryable: true,
            source: 'main',
            debugId: 'debug-chat-1',
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

  it('cancels active requests by request id', async () => {
    let capturedSignal: AbortSignal | undefined;

    const resolver: AiChatRuntimeResolverPort = {
      resolveProviderRuntimeConfig: async () => config,
    };

    const registry: AiChatProviderRegistryPort = {
      getAdapter: () => ({
        providerId: 'deepseek',
        async *streamChat(input): AsyncIterable<RuntimeEvent> {
          capturedSignal = input.signal;
          yield createAssistantDeltaEvent({
            eventId: input.eventIdFactory(),
            request,
            runId: 'run-1',
            sequence: input.nextSequence(),
            delta: 'partial',
            createdAt: '2026-05-11T00:00:02.000Z',
          });
        },
      }),
    };

    const service = new AiChatService({
      resolver,
      registry,
      runIdFactory: () => 'run-1',
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const iterator = service.streamChat(request)[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();

    expect(service.cancelChat('request-1')).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
  });
});
