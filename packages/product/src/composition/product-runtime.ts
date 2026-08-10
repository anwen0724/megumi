/*
 * Defines the runtime value held by a host process after Product composition.
 * Request-oriented product operations remain on ProductHostInterface.
 */
import type { EventFilter, EventHandler, EventSubscription } from '@megumi/events';
import type { ProductHostInterface } from '../host/product-host';
import type { SubmitVoiceUtteranceRequest, SubmitVoiceUtteranceResult } from '@megumi/voice';

export interface ProductVoiceAudioRuntime {
  submitUtterance(request: SubmitVoiceUtteranceRequest): Promise<SubmitVoiceUtteranceResult>;
}

export interface ProductRuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export interface ProductRuntime {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  readonly voiceAudio: ProductVoiceAudioRuntime;
  subscribeRuntimeEvents(filter: EventFilter, handler: EventHandler): EventSubscription;
  dispose(): Promise<void>;
}

/** Creates the host-facing runtime and guarantees that disposal starts once. */
export function createProductRuntime(input: {
  readonly host: ProductHostInterface;
  readonly logger: ProductRuntimeLogger;
  readonly voiceAudio: ProductVoiceAudioRuntime;
  readonly subscribeRuntimeEvents: ProductRuntime['subscribeRuntimeEvents'];
  readonly dispose: () => Promise<void>;
}): ProductRuntime {
  let disposePromise: Promise<void> | undefined;
  return {
    host: input.host,
    logger: input.logger,
    voiceAudio: input.voiceAudio,
    subscribeRuntimeEvents: input.subscribeRuntimeEvents,
    dispose() {
      disposePromise ??= input.dispose();
      return disposePromise;
    },
  };
}
