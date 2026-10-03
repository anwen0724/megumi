/* Controls the external model HTTP boundary while exercising the real AI and runtime. */
import { vi } from 'vitest';

/** Returns one OpenAI-compatible SSE response containing text or a tool request. */
export function modelResponse(input: string | { name: string; arguments: unknown }): Response {
  const delta = typeof input === 'string' ? { role: 'assistant', content: input } : {
    role: 'assistant', tool_calls: [{ index: 0, id: crypto.randomUUID(), type: 'function', function: {
      name: input.name, arguments: JSON.stringify(input.arguments),
    } }],
  };
  return new Response('data: ' + JSON.stringify({ id: 'response', object: 'chat.completion.chunk', created: 1,
    choices: [{ index: 0, delta, finish_reason: typeof input === 'string' ? 'stop' : 'tool_calls' }],
  }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

/** Holds HTTP responses until the test releases them; cancellation still aborts the request. */
export function controlModelHttp() {
  const pending: Array<(response: Response) => void> = [];
  const ready: Response[] = [];
  const requests: unknown[] = [];
  const arrivals: Array<() => void> = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    requests.push(options?.body ? JSON.parse(String(options.body)) : undefined);
    arrivals.splice(0).forEach(resolve => resolve());
    if (ready.length) return ready.shift()!;
    return new Promise<Response>((resolve, reject) => {
      const abort = () => { const index = pending.indexOf(deliver); if (index >= 0) pending.splice(index, 1); reject(new DOMException('Aborted', 'AbortError')); };
      const deliver = (response: Response) => { options?.signal?.removeEventListener('abort', abort); resolve(response); };
      pending.push(deliver);
      options?.signal?.addEventListener('abort', abort, { once: true });
      if (options?.signal?.aborted) abort();
    });
  });
  return {
    requests,
    async waitForRequest(count = 1) {
      while (requests.length < count) await new Promise<void>(resolve => arrivals.push(resolve));
    },
    respond(response: Response) { const accept = pending.shift(); if (accept) accept(response); else ready.push(response); },
    restore() { fetch.mockRestore(); },
  };
}
