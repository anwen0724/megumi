/*
 * Protects the provider request retry contract of every retained API adapter:
 * retries use an AbortSignal-cancellable backoff and SDK built-in retries are
 * disabled so cancellation always wins.
 */

// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { retryProviderRequest } from '@megumi/ai/utils/provider-retry';

const packageRoot = path.resolve(process.cwd(), 'packages', 'ai');

function providerError(status: number | undefined, headers?: Record<string, string>): Error {
  const error = new Error(`provider error ${status ?? 'network'}`);
  (error as { status?: number }).status = status;
  (error as { headers?: Headers | undefined }).headers = headers ? new Headers(headers) : undefined;
  return error;
}

describe('provider request retry (shared by all retained adapters)', () => {
  it('does not retry when maxRetries is 0', async () => {
    let calls = 0;
    await expect(
      retryProviderRequest(
        async () => {
          calls++;
          throw providerError(503);
        },
        { maxRetries: 0 },
      ),
    ).rejects.toThrow('provider error');
    expect(calls).toBe(1);
  });

  it('retries retryable statuses with an abortable backoff', async () => {
    let calls = 0;
    const controller = new AbortController();
    const attempt = retryProviderRequest(
      async () => {
        calls++;
        if (calls === 1) throw providerError(429, { 'retry-after': '1' });
        return 'ok';
      },
      { maxRetries: 2, signal: controller.signal },
    );
    expect(await attempt).toBe('ok');
    expect(calls).toBe(2);
  });

  it('aborts the backoff sleep when the signal fires', async () => {
    let calls = 0;
    const controller = new AbortController();
    const attempt = retryProviderRequest(
      async () => {
        calls++;
        throw providerError(503, { 'retry-after': '60' });
      },
      { maxRetries: 1, signal: controller.signal },
    ).catch((error: Error) => error);

    // Abort while the long backoff is sleeping.
    setTimeout(() => controller.abort(), 10);
    const error = await attempt;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('AbortError');
    expect(calls).toBe(1);
  });

  it('fails fast on non-retryable statuses', async () => {
    let calls = 0;
    await expect(
      retryProviderRequest(
        async () => {
          calls++;
          throw providerError(401);
        },
        { maxRetries: 3 },
      ),
    ).rejects.toThrow('provider error');
    expect(calls).toBe(1);
  });

  it('fails immediately when the server-requested delay exceeds maxRetryDelayMs', async () => {
    let calls = 0;
    await expect(
      retryProviderRequest(
        async () => {
          calls++;
          throw providerError(429, { 'retry-after': '120' });
        },
        { maxRetries: 2, maxRetryDelayMs: 1000 },
      ),
    ).rejects.toThrow(/retry delay/i);
    expect(calls).toBe(1);
  });

  it('normalizes Google SDK ApiError shapes before classification', async () => {
    // Google's SDK throws errors without a headers property; the adapter
    // normalizes them so the shared classifier can retry by status only.
    const { retryGoogleRequest } = await import('@megumi/ai/api/google-shared');
    let calls = 0;
    const result = await retryGoogleRequest(
      async () => {
        calls++;
        if (calls === 1) {
          const error = new Error('google 503');
          (error as { status?: number }).status = 503;
          throw error;
        }
        return 'ok';
      },
      { maxRetries: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('adapter wiring: cancellable retry with SDK retries disabled', () => {
  const adapters: Array<{ file: string; markers: string[] }> = [
    {
      // Anthropic SDK client is constructed with maxRetries: 0 and the
      // initial request is wrapped in the cancellable provider retry.
      file: 'anthropic-messages.ts',
      markers: ['maxRetries: 0', 'retryProviderRequest('],
    },
    {
      // OpenAI SDK client is constructed with maxRetries: 0 and the
      // initial request is wrapped in the cancellable provider retry.
      file: 'openai-completions.ts',
      markers: ['maxRetries: 0', 'retryProviderRequest('],
    },
    {
      file: 'openai-responses.ts',
      markers: ['maxRetries: 0', 'retryProviderRequest('],
    },
    {
      // The Codex adapter retries with its own abortable sleep loop.
      file: 'openai-codex-responses.ts',
      markers: ['await sleep(delayMs, options?.signal)'],
    },
    {
      // The Google adapter retries through the shared cancellable helper.
      file: 'google-generative-ai.ts',
      markers: ['retryGoogleRequest('],
    },
  ];

  it.each(adapters)('keeps the cancellable retry contract in $file', ({ file, markers }) => {
    const source = fs.readFileSync(path.join(packageRoot, 'src', 'api', file), 'utf8');
    for (const marker of markers) {
      expect(source).toContain(marker);
    }
  });

  it.each(adapters)('reports credential-free semantic exchanges in $file', ({ file }) => {
    const source = fs.readFileSync(path.join(packageRoot, 'src', 'api', file), 'utf8');
    expect(source).toContain('notifyProviderExchange(');
    expect(source).toContain('type: "request"');
    expect(source).toContain('type: "response"');
    expect(source).not.toMatch(/notifyProviderExchange\([^)]*(headers|apiKey|client)/s);
  });
});
