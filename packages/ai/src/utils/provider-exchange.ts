/*
 * Defines and safely emits provider-neutral observations of real adapter exchange boundaries.
 */

/** A closed fact emitted by a Provider Adapter without credentials or transport handles. */
export type ProviderExchange =
	| { readonly type: "request"; readonly attempt: number; readonly payload: unknown }
	| { readonly type: "response"; readonly attempt: number; readonly payload: unknown }
	| { readonly type: "output_started"; readonly attempt: number }
	| {
			readonly type: "retry_scheduled";
			readonly currentAttempt: number;
			readonly nextAttempt: number;
			readonly reasonCode: string;
	  }
	| {
			readonly type: "stream_interrupted";
			readonly attempt: number;
			readonly reasonCode: string;
			readonly partialResponse?: unknown;
	  };

export type ProviderExchangeObserver = (exchange: ProviderExchange) => void;

/** Keeps diagnostic observation outside the Provider request's success semantics. */
export function notifyProviderExchange(
	observer: ProviderExchangeObserver | undefined,
	exchange: ProviderExchange,
): void {
	try {
		observer?.(exchange);
	} catch {
		// A diagnostic callback never owns dispatch, retry, parsing, or stream settlement.
	}
}
