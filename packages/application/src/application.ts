/*
 * Defines the runtime value held by a concrete Host process after composition.
 */
import type { EventFilter, EventHandler, EventSubscription } from '@megumi/agent-runtime/events';
import type {
  SpeechOutputEventListener,
  SpeechOutputSubscription,
} from './voice/index';
import type { ApplicationOperations } from './contracts';

export interface ApplicationLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export type BackgroundTriggerMode = 'automatic' | 'manual';

export interface ApplicationStartOptions {
  readonly backgroundTriggers?: BackgroundTriggerMode;
}

export interface ResolvedApplicationStartOptions {
  readonly backgroundTriggers: BackgroundTriggerMode;
}

export interface Application extends ApplicationOperations {
  readonly logger: ApplicationLogger;
  /** Starts Host-ready product behavior exactly once using the first caller's trigger mode. */
  start(options?: ApplicationStartOptions): Promise<void>;
  /** Stops business execution while retaining resources for final read-only capture. */
  stop(): Promise<void>;
  subscribeRuntimeEvents(filter: EventFilter, handler: EventHandler): EventSubscription;
  subscribeSpeechOutputEvents(handler: SpeechOutputEventListener): SpeechOutputSubscription;
  dispose(): Promise<void>;
}

/** Creates the host-facing runtime and guarantees that disposal starts once. */
export function bindApplicationLifecycle(input: {
  readonly operations: ApplicationOperations;
  readonly logger: ApplicationLogger;
  readonly start: (options: ResolvedApplicationStartOptions) => Promise<void>;
  readonly subscribeRuntimeEvents: Application['subscribeRuntimeEvents'];
  readonly subscribeSpeechOutputEvents: Application['subscribeSpeechOutputEvents'];
  readonly dispose: () => Promise<void>;
  readonly stop: () => Promise<void>;
}): Application {
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  return {
    ...input.operations,
    logger: input.logger,
    start(options = {}) {
      const backgroundTriggers = options.backgroundTriggers ?? 'automatic';
      // The Host remains available for recovery, but no automatic business may use fallback settings.
      startPromise ??= (async () => {
        const settings = input.operations.settings.readSettings();
        if (settings.status === 'rejected') throw new Error('Settings are invalid; product background startup was blocked.');
        if (disposePromise || stopPromise) throw new Error('Product runtime has already begun disposal or stopping.');
        await input.start({ backgroundTriggers });
      })();
      return startPromise;
    },
    subscribeRuntimeEvents: input.subscribeRuntimeEvents,
    subscribeSpeechOutputEvents: input.subscribeSpeechOutputEvents,
    stop() {
      stopPromise ??= input.stop();
      return stopPromise;
    },
    dispose() {
      disposePromise ??= input.dispose();
      return disposePromise;
    },
  };
}
