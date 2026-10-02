/* Captures AI transport facts in the application's existing diagnostic journal. */
import type { AssistantMessage, AssistantMessageEvent, SimpleStreamOptions } from '@megumi/ai';
import type { Observability } from './trace/observability';
import type { TraceCorrelation } from './trace/trace-contract';

/** Creates independent capture state for one model request. */
export function createProviderCapture(input: {
  readonly observability?: Observability;
  readonly correlation: TraceCorrelation;
  readonly fetch?: typeof globalThis.fetch;
}): {
  options: SimpleStreamOptions;
  /** Records observed output facts without consuming or changing the event. */
  observe(event: AssistantMessageEvent): void;
  /** Records interruption after the stream settles; never changes its outcome. */
  complete(message: AssistantMessage | undefined): void;
} {
  let payload: unknown;
  let attempt = 0;
  let previousFailure = 'network_error';
  let outputStarted = false;
  const transport = input.fetch ?? globalThis.fetch;

  /** Capture failures cannot change transport, retries, or the model outcome. */
  function content(kind: Parameters<Observability['recordContent']>[0]['kind'], value: unknown): void {
    try {
      input.observability?.recordContent({
        kind, value: omitUndefinedFields(value),
        correlation: { ...input.correlation, ...(attempt ? { providerAttempt: attempt } : {}) },
      });
    } catch {
      // The existing journal owns diagnostic failure reporting.
    }
  }

  /** Isolates journal failures from the observed operation. */
  function event(value: Parameters<Observability['recordEvent']>[0]): void {
    try { input.observability?.recordEvent(value); } catch {
      // Observing an operation must never repeat or interrupt it.
    }
  }

  return {
    options: input.observability ? {
      onPayload(value) {
        payload = value;
        content('model.provider_request', value);
        // Undefined preserves the AI layer's payload exactly.
      },
      async fetch(request, init) {
        attempt++;
        if (attempt > 1) event({
          type: 'model.retry.started', currentAttempt: attempt - 1,
          nextAttempt: attempt, reasonCode: previousFailure,
        });
        content('model.provider_request', payload);
        try {
          const response = await transport(request, init);
          previousFailure = `http_${response.status}`;
          content('model.provider_response', {
            status: response.status, headers: Object.fromEntries(response.headers.entries()),
          });
          return response;
        } catch (error) {
          previousFailure = 'network_error';
          content('model.provider_response', {
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
          throw error;
        }
      },
      onResponse(response) {
        // HTTP requests already recorded by fetch must not produce a duplicate.
        if (attempt === 0) content('model.provider_response', response);
      },
      onProviderStreamEvent(value) { content('model.provider_event', value); },
    } : { ...(input.fetch ? { fetch: input.fetch } : {}) },
    observe(value) {
      if (!outputStarted && (value.type === 'text_delta' || value.type === 'thinking_delta'
        || value.type === 'toolcall_delta')) {
        outputStarted = true;
        event({ type: 'model.output.started', ...(attempt ? { providerAttempt: attempt } : {}) });
      }
    },
    complete(message) {
      if (outputStarted && (!message || message.stopReason === 'error' || message.stopReason === 'aborted')) {
        event({
          type: 'model.stream.interrupted', ...(attempt ? { providerAttempt: attempt } : {}),
          reasonCode: message?.stopReason ?? 'missing_terminal',
        });
      }
    },
  };
}

/** Omits provider payload omissions before the diagnostic serializer validates them. */
function omitUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefinedFields).filter((item) => item !== undefined);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
    child === undefined ? [] : [[key, omitUndefinedFields(child)]],
  ));
}
