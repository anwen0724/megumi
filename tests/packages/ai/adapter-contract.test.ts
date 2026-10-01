/* Verifies retry limits, provider backoff, and cancellation behavior. */

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { retryProviderRequest } from '@megumi/ai/utils/provider-retry';

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
