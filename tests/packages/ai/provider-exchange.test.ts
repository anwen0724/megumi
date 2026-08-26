// @vitest-environment node
/*
 * Protects the provider exchange observation contract and its isolation from real retries.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  notifyProviderExchange,
  type ProviderExchange,
} from '@megumi/ai';
import { retryProviderRequest } from '@megumi/ai/utils/provider-retry';

function providerError(status: number): Error {
  const error = new Error(`provider ${status}`);
  Object.defineProperties(error, {
    status: { value: status },
    headers: { value: new Headers({ 'retry-after-ms': '0' }) },
  });
  return error;
}

describe('Provider exchange observation', () => {
  it('reports one-based dispatch attempts and the retry scheduled between them', async () => {
    const dispatched: number[] = [];
    const retries: ProviderExchange[] = [];

    const result = await retryProviderRequest(async (attempt) => {
      dispatched.push(attempt);
      if (attempt === 1) throw providerError(429);
      return 'ok';
    }, {
      maxRetries: 1,
      onRetryScheduled: (event) => retries.push({ type: 'retry_scheduled', ...event }),
    });

    expect(result).toBe('ok');
    expect(dispatched).toEqual([1, 2]);
    expect(retries).toEqual([{
      type: 'retry_scheduled',
      currentAttempt: 1,
      nextAttempt: 2,
      reasonCode: 'http_429',
    }]);
  });

  it('does not change dispatch count or result when an observer throws', async () => {
    const dispatch = vi.fn(async (attempt: number) => attempt);

    const result = await retryProviderRequest(async (attempt) => {
      notifyProviderExchange(() => { throw new Error('diagnostics failed'); }, {
        type: 'request',
        attempt,
        payload: { messages: ['actual'] },
      });
      return dispatch(attempt);
    });

    expect(result).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
