import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";
import {
	classifyModelFailure,
	withSafeModelFailure,
} from "../model-failure.ts";
import { overflowErrorMessage } from "./overflow.ts";

type AssistantMessageEventInput =
	| Exclude<AssistantMessageEvent, { type: "error" }>
	| {
			type: "error";
			reason: "aborted" | "error";
			error: AssistantMessage;
			failure?: AssistantMessage["failure"];
			cause?: unknown;
	  };

// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: ((value: IteratorResult<T>) => void)[] = [];
	private done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private settlementPromise: Promise<void>;
	private resolveSettlement!: () => void;
	private settled = false;
	private isComplete: (event: T) => boolean;
	private extractResult: (event: T) => R;

	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
		this.settlementPromise = new Promise((resolve) => {
			this.resolveSettlement = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
			this.settle();
		}

		// Deliver to waiting consumer or queue it
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: R): void {
		if (this.done) {
			this.settle();
			return;
		}
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		// Notify all waiting consumers that we're done
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as any, done: true });
		}
		this.settle();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}

	waitForSettlement(): Promise<void> {
		return this.settlementPromise;
	}

	private settle(): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveSettlement();
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				} else if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result");
			},
		);
	}

	override push(event: AssistantMessageEventInput): void {
		if (event.type !== "error") {
			super.push(event);
			return;
		}
		const failure = classifyModelFailure({
			reason: event.reason,
			failure: event.failure ?? event.error.failure,
			error: event.cause,
		});
		const safeError = withSafeModelFailure(event.error, failure);
		// Provider streams reuse one mutable AssistantMessage across partial events.
		// Normalize that same object so previously emitted partial references cannot
		// reveal a raw provider error after the terminal catch mutates it. The one
		// deliberate exception is a provider error text matching the Overflow
		// signature: the Engine needs that text to recover via compaction.
		const overflowMessage = overflowErrorMessage(event.cause, event.error.errorMessage);
		const normalized = overflowMessage === undefined
			? safeError
			: { ...safeError, errorMessage: overflowMessage };
		Object.assign(event.error, normalized);
		const { cause: _cause, ...publicEvent } = event;
		super.push({
			...publicEvent,
			failure,
			error: event.error,
		});
	}

	fail(input: {
		reason: "aborted" | "error";
		error: AssistantMessage;
		cause?: unknown;
		failure?: AssistantMessage["failure"];
	}): void {
		this.push({ type: "error", ...input });
	}
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
