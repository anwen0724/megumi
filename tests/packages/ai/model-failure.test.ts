// Verifies provider-neutral model failure classification and safe stream exposure.
import { describe, expect, it } from 'vitest';
import {
  AssistantMessageEventStream,
  ModelFailureError,
  classifyModelFailure,
  createModels,
  createModelFailure,
  isRetryableAssistantError,
  type AssistantMessage,
  type Model,
  type ModelFailure,
  type Provider,
} from '@megumi/ai';

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function failedMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'test-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: ZERO_USAGE,
    stopReason: 'error',
    timestamp: 1,
    ...overrides,
  };
}

describe('provider-neutral model failure classification', () => {
  it('classifies aborts as terminal and never retryable', () => {
    expect(classifyModelFailure({ reason: 'aborted' })).toEqual<ModelFailure>({
      code: 'aborted',
      message: 'Model call was aborted.',
      retryable: false,
    });
    expect(isRetryableAssistantError(failedMessage({
      stopReason: 'aborted',
      failure: createModelFailure({ code: 'rate_limited', retryable: true }),
    }))).toBe(false);
  });

  it('preserves authoritative retry metadata without parsing error text', () => {
    const failure = classifyModelFailure({
      reason: 'error',
      error: new ModelFailureError({
        code: 'rate_limited',
        retryable: true,
        retryAfterMs: 1_250,
      }),
    });

    expect(failure).toEqual<ModelFailure>({
      code: 'rate_limited',
      message: 'The model provider rate limit was reached.',
      retryable: true,
      retryAfterMs: 1_250,
    });
    expect(isRetryableAssistantError(failedMessage({ failure }))).toBe(true);
  });

  it('classifies OpenAI-compatible numeric status and Retry-After headers', () => {
    const error = Object.assign(new Error('raw provider body'), {
      status: 429,
      headers: new Headers({ 'retry-after': '1.25' }),
    });

    expect(classifyModelFailure({ reason: 'error', error })).toEqual<ModelFailure>({
      code: 'rate_limited',
      message: 'The model provider rate limit was reached.',
      retryable: true,
      retryAfterMs: 1_250,
    });
  });

  it('classifies Anthropic-style response metadata without reading error text or body', () => {
    const error = {
      status: 503,
      headers: { 'Retry-After': '2' },
      message: 'invalid api key HTTP 401',
      error: { body: 'secret-provider-body' },
    };

    expect(classifyModelFailure({ reason: 'error', error })).toEqual<ModelFailure>({
      code: 'provider_unavailable',
      message: 'The model provider is unavailable.',
      retryable: true,
      retryAfterMs: 2_000,
    });
    expect(classifyModelFailure({
      reason: 'error',
      error: { status: 403, message: 'HTTP 503 retry me' },
    })).toEqual<ModelFailure>({
      code: 'authentication_failed',
      message: 'Model authentication failed.',
      retryable: false,
    });
  });

  it.each([
    [401, 'authentication_failed', false],
    [403, 'authentication_failed', false],
    [400, 'invalid_request', false],
    [404, 'invalid_request', false],
    [422, 'invalid_request', false],
    [408, 'provider_unavailable', true],
    [409, 'provider_unavailable', true],
    [425, 'provider_unavailable', true],
    [500, 'provider_unavailable', true],
    [599, 'provider_unavailable', true],
  ] as const)('maps HTTP %i using structured status metadata', (status, code, retryable) => {
    expect(classifyModelFailure({
      reason: 'error',
      error: { status },
    })).toMatchObject({ code, retryable });
  });

  it('classifies explicit Node transport codes and gives abort metadata priority', () => {
    expect(classifyModelFailure({
      reason: 'error',
      error: { cause: { code: 'ECONNRESET' } },
    })).toEqual<ModelFailure>({
      code: 'transport_failed',
      message: 'The model provider connection failed.',
      retryable: true,
    });
    expect(classifyModelFailure({
      reason: 'error',
      error: { name: 'AbortError', status: 503 },
    })).toEqual<ModelFailure>({
      code: 'aborted',
      message: 'Model call was aborted.',
      retryable: false,
    });
  });

  it('keeps string status and unrecognized codes unknown', () => {
    expect(classifyModelFailure({
      reason: 'error',
      error: { status: '429', code: 'SOME_PROVIDER_CODE', message: 'HTTP 503' },
    })).toEqual<ModelFailure>({
      code: 'unknown',
      message: 'Model call failed.',
      retryable: false,
    });
  });

  it('exposes classified failures through the existing Models.streamSimple path', async () => {
    const model: Model<'test-api'> = {
      id: 'test-model',
      name: 'Test Model',
      api: 'test-api',
      provider: 'test-provider',
      baseUrl: 'https://provider.invalid',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000,
      maxTokens: 100,
    };
    const provider: Provider<'test-api'> = {
      id: 'test-provider',
      name: 'Test Provider',
      auth: {
        apiKey: {
          name: 'test',
          resolve: async () => ({ auth: { apiKey: 'test-key' } }),
        },
      },
      getModels: () => [model],
      stream: () => {
        throw new ModelFailureError({ code: 'provider_unavailable', retryable: true, retryAfterMs: 500 });
      },
      streamSimple: () => {
        throw new ModelFailureError({ code: 'provider_unavailable', retryable: true, retryAfterMs: 500 });
      },
    };
    const models = createModels();
    models.setProvider(provider);

    const stream = models.streamSimple(model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      failure: {
        code: 'provider_unavailable',
        message: 'The model provider is unavailable.',
        retryable: true,
        retryAfterMs: 500,
      },
    });
    expect(result.failure).toEqual({
      code: 'provider_unavailable',
      message: 'The model provider is unavailable.',
      retryable: true,
      retryAfterMs: 500,
    });
  });

  it('defaults unknown failures to non-retryable', () => {
    const failure = classifyModelFailure({
      reason: 'error',
      error: new Error('HTTP 503: retry me'),
    });

    expect(failure).toEqual<ModelFailure>({
      code: 'unknown',
      message: 'Model call failed.',
      retryable: false,
    });
    expect(isRetryableAssistantError(failedMessage({ errorMessage: 'HTTP 503: retry me' }))).toBe(false);
  });

  it('does not expose provider raw error bodies through error events or results', async () => {
    const sensitiveBody = '{"error":"failed","api_key":"secret-provider-token"}';
    const stream = new AssistantMessageEventStream();
    const source = failedMessage();
    stream.push({ type: 'start', partial: source });
    source.errorMessage = sensitiveBody;
    source.diagnostics = [{
        type: 'provider_failure',
        timestamp: 1,
        error: {
          name: 'ProviderError',
          message: sensitiveBody,
          stack: `ProviderError: ${sensitiveBody}`,
          code: 503,
        },
        details: { rawBody: sensitiveBody },
    }];

    stream.push({
      type: 'error',
      reason: 'error',
      failure: createModelFailure({ code: 'unknown', retryable: false }),
      error: source,
    });

    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    const serialized = JSON.stringify({ events, result });

    expect(serialized).not.toContain(sensitiveBody);
    expect(serialized).not.toContain('secret-provider-token');
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      failure: { code: 'unknown', message: 'Model call failed.', retryable: false },
      error: {
        errorMessage: 'Model call failed.',
        failure: { code: 'unknown', message: 'Model call failed.', retryable: false },
      },
    });
  });

  it('classifies a raw adapter cause before the shared stream terminates', async () => {
    const sensitiveBody = 'secret-anthropic-body';
    const stream = new AssistantMessageEventStream();
    const source = failedMessage();
    stream.push({ type: 'start', partial: source });
    stream.fail({
      reason: 'error',
      error: source,
      cause: {
        statusCode: 408,
        headers: { 'retry-after': '0.5' },
        body: sensitiveBody,
      },
    });
    stream.end();

    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    const serialized = JSON.stringify({ events, result });

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      failure: {
        code: 'provider_unavailable',
        message: 'The model provider is unavailable.',
        retryable: true,
        retryAfterMs: 500,
      },
    });
    expect(serialized).not.toContain(sensitiveBody);
  });
});
