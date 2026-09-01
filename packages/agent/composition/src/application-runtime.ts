/*
 * Defines the runtime value held by a concrete Host process after composition.
 */
import type { EventFilter, EventHandler, EventSubscription } from '@megumi/events';
import type {
  SpeechOutputEventListener,
  SpeechOutputSubscription,
} from '@megumi/voice';
import type { ProductHostInterface } from '@megumi/product-host/host';

export interface ProductRuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export type ProductBackgroundTriggerMode = 'automatic' | 'manual';

export interface ProductRuntimeStartOptions {
  readonly backgroundTriggers?: ProductBackgroundTriggerMode;
}

export interface ResolvedProductRuntimeStartOptions {
  readonly backgroundTriggers: ProductBackgroundTriggerMode;
}

export interface ProductRuntime {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  /** Starts Host-ready product behavior exactly once using the first caller's trigger mode. */
  start(options?: ProductRuntimeStartOptions): Promise<void>;
  subscribeRuntimeEvents(filter: EventFilter, handler: EventHandler): EventSubscription;
  subscribeSpeechOutputEvents(handler: SpeechOutputEventListener): SpeechOutputSubscription;
  dispose(): Promise<void>;
}

/** Creates the host-facing runtime and guarantees that disposal starts once. */
export function createApplicationRuntime(input: {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  readonly start: (options: ResolvedProductRuntimeStartOptions) => Promise<void>;
  readonly subscribeRuntimeEvents: ProductRuntime['subscribeRuntimeEvents'];
  readonly subscribeSpeechOutputEvents: ProductRuntime['subscribeSpeechOutputEvents'];
  readonly dispose: () => Promise<void>;
}): ProductRuntime {
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  return {
    host: input.host,
    logger: input.logger,
    start(options = {}) {
      startPromise ??= input.start({
        backgroundTriggers: options.backgroundTriggers ?? 'automatic',
      });
      return startPromise;
    },
    subscribeRuntimeEvents: input.subscribeRuntimeEvents,
    subscribeSpeechOutputEvents: input.subscribeSpeechOutputEvents,
    dispose() {
      disposePromise ??= input.dispose();
      return disposePromise;
    },
  };
}
