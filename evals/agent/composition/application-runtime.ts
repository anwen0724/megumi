/*
 * Defines the runtime value held by a concrete Host process after composition.
 */
import type { EventFilter, EventHandler, EventSubscription } from '@megumi/events';
import type {
  SpeechOutputEventListener,
  SpeechOutputSubscription,
} from '@megumi/voice';
import type { ProductHostInterface } from '@megumi/product/host';

export interface ProductRuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export interface ProductRuntime {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  subscribeRuntimeEvents(filter: EventFilter, handler: EventHandler): EventSubscription;
  subscribeSpeechOutputEvents(handler: SpeechOutputEventListener): SpeechOutputSubscription;
  dispose(): Promise<void>;
}

/** Creates the host-facing runtime and guarantees that disposal starts once. */
export function createApplicationRuntime(input: {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  readonly subscribeRuntimeEvents: ProductRuntime['subscribeRuntimeEvents'];
  readonly subscribeSpeechOutputEvents: ProductRuntime['subscribeSpeechOutputEvents'];
  readonly dispose: () => Promise<void>;
}): ProductRuntime {
  let disposePromise: Promise<void> | undefined;
  return {
    host: input.host,
    logger: input.logger,
    subscribeRuntimeEvents: input.subscribeRuntimeEvents,
    subscribeSpeechOutputEvents: input.subscribeSpeechOutputEvents,
    dispose() {
      disposePromise ??= input.dispose();
      return disposePromise;
    },
  };
}
