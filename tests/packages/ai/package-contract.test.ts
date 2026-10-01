/* Verifies model streaming outcomes and terminal failure behavior. */

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Model,
} from '@megumi/ai';
// The stream class is a value; it is exported as a type from the package entry
// and imported from its defining module when constructed in tests.
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';

function zeroUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function failedMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'test-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: zeroUsage(),
    stopReason: 'error',
    errorMessage: 'test failure',
    timestamp: 1,
    ...overrides,
  };
}

describe('AI package contract', () => {
  it.each(['done', 'error'] as const)(
    'terminates AssistantMessageEventStream with a %s event',
    async (termination) => {
      const stream = new AssistantMessageEventStream();
      const message = termination === 'done' ? fauxAssistantMessage('done') : failedMessage();

      stream.push(
        termination === 'done'
          ? { type: 'done', reason: 'stop', message }
          : { type: 'error', reason: 'error', error: message },
      );

      const events = [];
      for await (const event of stream) events.push(event);
      const result = await stream.result();

      expect(events.at(-1)?.type).toBe(termination);
      expect(result).toBe(message);
    },
  );

  it('returns a terminal zero-usage AssistantMessage from result() for a pre-call failure', async () => {
    const models = createModels();
    const model: Model<Api> = {
      id: 'exploding',
      name: 'Exploding',
      api: 'test-api',
      provider: 'test-provider',
      baseUrl: 'https://provider.invalid',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };
    models.setProvider(
      createProvider({
        id: 'test-provider',
        auth: { apiKey: { name: 'test', resolve: async () => ({ auth: {} }) } },
        models: [model],
        api: {
          stream: () => {
            throw new Error('provider unavailable before call');
          },
          streamSimple: () => {
            throw new Error('provider unavailable before call');
          },
        },
      }),
    );

    const stream = models.streamSimple(model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events.at(-1)?.type).toBe('error');
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('provider unavailable before call');
    expect(result.usage).toEqual(zeroUsage());
  });

  it('returns a terminal AssistantMessage from result() after cancellation', async () => {
    const controller = new AbortController();
    const models = createModels();
    const handle = fauxProvider({ models: [{ id: 'abortable' }] });
    models.setProvider(handle.provider);
    handle.setResponses([fauxAssistantMessage('a slow response that gets aborted')]);

    const stream = models.streamSimple(handle.getModel('abortable') as Model<Api>, { messages: [] }, {
      signal: controller.signal,
    });
    controller.abort();

    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(['error', 'aborted']).toContain(result.stopReason);
    expect(events.at(-1)?.type).toBe('error');
  });

  it('returns a terminal AssistantMessage from result() after a timeout signal', async () => {
    const models = createModels();
    // Slow streaming so the timeout fires while the response is in flight.
    const handle = fauxProvider({ models: [{ id: 'slow' }], tokensPerSecond: 10 });
    models.setProvider(handle.provider);
    handle.setResponses([fauxAssistantMessage('this response streams slowly and will be cut short by the timeout')]);

    const stream = models.streamSimple(handle.getModel('slow') as Model<Api>, { messages: [] }, {
      signal: AbortSignal.timeout(20),
    });

    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(['error', 'aborted']).toContain(result.stopReason);
    expect(events.at(-1)?.type).toBe('error');
  });
});
