/*
 * Protects the AI package's Megumi contracts after the wholesale replacement
 * with the latest pi AI implementation: core public types, the stream
 * terminal contract, the required usage field and the package entry points.
 */

// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssistantMessageEventStream,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Model,
} from '@megumi/ai';

const packageRoot = path.resolve(process.cwd(), 'packages', 'ai');

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

  it('keeps AssistantMessage.usage required and fully shaped', () => {
    expect(fauxAssistantMessage('hello').usage).toEqual(zeroUsage());
    // The public contract must not offer an optional-usage escape hatch.
    const message: AssistantMessage = fauxAssistantMessage('x');
    expect('usage' in message).toBe(true);
  });

  it('does not expose waitForSettlement() or fail() on the public stream', () => {
    const stream = new AssistantMessageEventStream();
    expect(stream).not.toHaveProperty('waitForSettlement');
    expect(stream).not.toHaveProperty('fail');
    expect(typeof stream.push).toBe('function');
    expect(typeof stream.end).toBe('function');
    expect(typeof stream.result).toBe('function');
  });

  it('does not expose ModelFailure or the old failure classification helpers', async () => {
    const exported = Object.keys(await import('@megumi/ai'));
    expect(exported).not.toContain('ModelFailure');
    expect(exported).not.toContain('ModelFailureError');
    expect(exported).not.toContain('classifyModelFailure');
    expect(exported).not.toContain('createModelFailure');
  });

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

    const stream = models.streamSimple(handle.getModel('abortable'), { messages: [] }, {
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

    const stream = models.streamSimple(handle.getModel('slow'), { messages: [] }, {
      signal: AbortSignal.timeout(20),
    });

    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(['error', 'aborted']).toContain(result.stopReason);
    expect(events.at(-1)?.type).toBe('error');
  });

  it('keeps the independent publish and build entry points', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      bin: Record<string, string>;
      files: string[];
      sideEffects: string[];
    };

    expect(manifest.exports).toMatchObject({
      '.': expect.any(Object),
      './providers/*': expect.any(Object),
      './api/*': expect.any(Object),
      './bun-oauth': expect.any(Object),
    });
    expect(manifest.bin).toEqual({ 'megumi-ai': 'dist/cli.js' });
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'README.md']));
    expect(manifest.sideEffects).toEqual(expect.arrayContaining([
      './dist/images.js',
      './dist/providers/images/register-builtins.js',
    ]));
    expect(fs.existsSync(path.join(packageRoot, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'models.generated.ts'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'image-models.generated.ts'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'providers', 'data', '.manifest.json'))).toBe(true);
  });
});
