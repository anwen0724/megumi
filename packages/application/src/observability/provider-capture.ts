/* Records real provider requests and execution boundaries without storing stream fragments. */
import type { SimpleStreamOptions } from '@megumi/ai';
import type { Observability } from './trace/observability';
import type { TraceCorrelation } from './trace/trace-contract';

/** Connects one model call to adapter observations; the Agent records its completed reply. */
export function createProviderCapture(input: {
  readonly observability?: Observability;
  readonly correlation: TraceCorrelation;
  readonly fetch?: typeof globalThis.fetch;
}): { readonly options: Pick<SimpleStreamOptions, 'fetch' | 'onProviderExchange'> } {
  const { observability, correlation, fetch } = input;
  return {
    options: {
      ...(fetch ? { fetch } : {}),
      ...(observability ? {
        onProviderExchange(exchange) {
          switch (exchange.type) {
            case 'request':
              observability.recordContent({
                kind: 'model.provider_request',
                value: omitUndefinedFields(exchange.payload),
                correlation: { ...correlation, providerAttempt: exchange.attempt },
              });
              break;
            case 'output_started':
              observability.recordEvent({
                type: 'model.output.started', providerAttempt: exchange.attempt,
              });
              break;
            case 'retry_scheduled':
              observability.recordEvent({
                type: 'model.retry.scheduled',
                currentAttempt: exchange.currentAttempt,
                nextAttempt: exchange.nextAttempt,
                reasonCode: exchange.reasonCode,
              });
              break;
            case 'stream_interrupted':
              observability.recordEvent({
                type: 'model.stream.interrupted',
                providerAttempt: exchange.attempt,
                reasonCode: exchange.reasonCode,
              });
              break;
          }
        },
      } : {}),
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
