/* Bounds third-party JSON reads and returns declared transport failures. */
import type { z } from 'zod';
import type { SourceFailure, SourceFailureCode, SourceSearchRequest } from './source-connector';

export class SourceBudgetExceeded extends Error { }

/** Applies the caller's shared budget at the physical transport boundary. */
export function budgetedSourceFetch(fetch: typeof globalThis.fetch, reserve: SourceSearchRequest['reserveRequest'], kind: 'search' | 'material' | 'bilibili'): typeof globalThis.fetch {
  return async (url, init) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    const unit = kind === 'bilibili' ? new URL(String(url)).pathname.includes('/search/') ? 'search' : 'material' : kind;
    if (reserve && !reserve(unit)) throw new SourceBudgetExceeded();
    return fetch(url, init);
  };
}

export function sourceFailure(code: SourceFailureCode, message: string, retryAfterMs?: number): { status: 'failed'; failure: SourceFailure } {
  return {
    status: 'failed', failure: {
      code,
      message,
      retryable: ['network_error', 'timeout', 'unavailable', 'rate_limited'].includes(code),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
    }
  };
}

/** Reads at most 2 MiB; caller cancellation stops the request and its body. */
export async function requestSourceJson<T>(fetch: typeof globalThis.fetch, url: string | URL, init: RequestInit, schema: z.ZodType<T>, timeoutMs = 30_000, transformJson: (body: string) => string = (body) => body): Promise<{ status: 'success'; payload: T } | { status: 'failed'; failure: SourceFailure }> {
  return retrySourceRequest(() => requestSourceJsonOnce(fetch, url, init, schema, timeoutMs, transformJson), init.signal ?? undefined);
}

/** Retries only transient failures, leaving authentication, cooling and format errors to fallback. */
export async function retrySourceRequest<T extends { status: 'success' } | { status: 'failed'; failure: SourceFailure }>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T | { status: 'failed'; failure: SourceFailure }> {
  const retryDelays = [5_000, 30_000];
  for (let attempt = 0;;attempt++) {
    if (signal?.aborted) return sourceFailure('cancelled', 'Source request was cancelled.');
    const result = await operation();
    if (result.status === 'success' || !['network_error', 'timeout', 'unavailable'].includes(result.failure.code) || attempt >= retryDelays.length) return result;
    try { await waitForRetry(retryDelays[attempt]!, signal); }
    catch { return sourceFailure('cancelled', 'Source request was cancelled.'); }
  }
}

async function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Promise<void>((resolve) => { timer = setTimeout(resolve, delay); });
  try { await (signal ? abortable(waiting, signal) : waiting); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

async function requestSourceJsonOnce<T>(fetch: typeof globalThis.fetch, url: string | URL, init: RequestInit, schema: z.ZodType<T>, timeoutMs: number, transformJson: (body: string) => string): Promise<{ status: 'success'; payload: T } | { status: 'failed'; failure: SourceFailure }> {
  if (init.signal?.aborted) return sourceFailure('cancelled', 'Source request was cancelled.');
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  try {
    const response = await abortable(fetch(url, { ...init, signal }), signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) return sourceFailure('unauthorized', 'Source rejected authentication.');
      if (response.status === 412) return sourceFailure('challenge_required', 'Source requires verification.', 30 * 60_000);
      if (response.status === 429) {
        const value = response.headers.get('retry-after');
        const delay = value ? (/^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now())) : 5 * 60_000;
        return sourceFailure('rate_limited', 'Source rate limited the request.', Number.isFinite(delay) ? delay : 5 * 60_000);
      }
      return sourceFailure(response.status >= 500 ? 'unavailable' : 'invalid_response', `Source returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) return sourceFailure('invalid_response', 'Source returned no response body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        if (signal.aborted) throw signal.reason;
        const part = await abortable(reader.read(), signal);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) {
          void reader.cancel().catch(() => undefined);
          return sourceFailure('material_too_large', 'Source response exceeded 2 MiB.');
        }
        chunks.push(part.value);
      }
    } finally {
      if (signal.aborted) void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    let payload: unknown;
    try { payload = JSON.parse(transformJson(Buffer.concat(chunks).toString('utf8'))); } catch {
      return sourceFailure('invalid_response', 'Source response was not JSON.');
    }
    const parsed = schema.safeParse(payload);
    return parsed.success ? { status: 'success', payload: parsed.data } : sourceFailure('invalid_response', 'Source response format changed.');
  } catch (error) {
    if (error instanceof SourceBudgetExceeded) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
    if (init.signal?.aborted) return sourceFailure('cancelled', 'Source request was cancelled.');
    if (deadline.aborted) return sourceFailure('timeout', 'Source request timed out.');
    return sourceFailure('network_error', 'Source request failed.');
  }
}

/** Bounds waiting even when an external transport does not reject on cancellation. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => undefined); throw signal.reason; }
  let abort: () => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
