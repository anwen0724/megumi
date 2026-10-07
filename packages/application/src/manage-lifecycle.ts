/*
 * Owns application startup, business shutdown and resource disposal.
 * Composition registers resources before binding the finished application interface.
 */
import type { Coding } from './coding/submit-message';
import type { EventSubscription } from './coding/events/event-bus';
import type {
  Application,
  ApplicationLogger,
  ApplicationOperations,
  BackgroundTriggerMode,
} from './contracts';
import type { Recommendation } from './recommendation/recommendation-api';
import type { DatabaseConnection } from './storage/index';
import type { Voice } from './voice/index';

interface ApplicationBindings {
  readonly operations: ApplicationOperations;
  readonly logger: ApplicationLogger;
  readonly start: (options: { backgroundTriggers: BackgroundTriggerMode }) => Promise<void>;
  readonly subscribeRuntimeEvents: Application['subscribeRuntimeEvents'];
  readonly subscribeSpeechOutputEvents: Application['subscribeSpeechOutputEvents'];
  readonly recommendation: Pick<Recommendation, 'shutdown' | 'resumeBackground'>;
  readonly coding: Pick<Coding, 'shutdown'>;
  readonly voice: Pick<Voice, 'dispose'>;
  readonly speechOutput: { dispose(): void };
  readonly observability: { shutdown(): Promise<void> };
}

interface DisposalFailure {
  readonly resource: 'voice' | 'speech-output' | 'events' | 'observability' | 'database';
  readonly error: unknown;
}

export interface ApplicationLifecycle {
  /** Binds the completed modules to the application's shared lifecycle state. */
  bind(input: ApplicationBindings): Application;
  /** Registers the application database for rollback and final disposal. */
  registerDatabase(database: Pick<DatabaseConnection, 'close'>): void;
  /** Registers an application-owned subscription for rollback and final disposal. */
  registerEventSubscription(subscription: EventSubscription): void;
  /** Releases partially composed resources without replacing the startup error. */
  rollbackStartup(): void;
}

/** Creates the lifecycle owner before composition so startup failures can release resources. */
export function createApplicationLifecycle(options: {
  readonly shutdownTimeoutMs: number;
}): ApplicationLifecycle {
  let database: Pick<DatabaseConnection, 'close'> | undefined;
  const subscriptions: EventSubscription[] = [];

  return {
    registerDatabase(resource) {
      database = resource;
    },
    registerEventSubscription(subscription) {
      subscriptions.push(subscription);
    },
    rollbackStartup() {
      for (const subscription of [...subscriptions].reverse()) {
        try {
          subscription.unsubscribe();
        } catch {
          // Rollback must preserve the original composition failure.
        }
      }
      try {
        database?.close();
      } catch {
        // Rollback must preserve the original composition failure.
      }
    },
    bind(input) {
      let startPromise: Promise<void> | undefined;
      let stopPromise: Promise<void> | undefined;
      let disposePromise: Promise<void> | undefined;
      let stopping = false;

      /** Stops business once; a failed or timed-out attempt leaves resources open for retry. */
      function stop(): Promise<void> {
        stopping = true;
        stopPromise ??= stopBusiness(input, options.shutdownTimeoutMs).catch((error: unknown) => {
          stopPromise = undefined;
          throw error;
        });
        return stopPromise;
      }

      /** Waits for real business completion before releasing resources that it may still use. */
      async function dispose(): Promise<void> {
        await stop();
        const failures: DisposalFailure[] = [];
        try {
          await input.voice.dispose();
        } catch (error) {
          failures.push({ resource: 'voice', error });
        }
        try {
          input.speechOutput.dispose();
        } catch (error) {
          failures.push({ resource: 'speech-output', error });
        }
        for (const subscription of subscriptions) {
          try {
            subscription.unsubscribe();
          } catch (error) {
            failures.push({ resource: 'events', error });
          }
        }
        try {
          await input.observability.shutdown();
        } catch (error) {
          failures.push({ resource: 'observability', error });
        }
        try {
          database?.close();
        } catch (error) {
          failures.push({ resource: 'database', error });
        }
        if (failures.length > 0) {
          throw new AggregateError(
            failures.map((failure) => failure.error),
            `Product disposal failed for: ${failures.map((failure) => failure.resource).join(', ')}.`,
          );
        }
      }

      return {
        ...input.operations,
        logger: input.logger,
        start(startOptions = {}) {
          const backgroundTriggers = startOptions.backgroundTriggers ?? 'automatic';
          startPromise ??= (async () => {
            const settings = input.operations.settings.readSettings();
            if (settings.status === 'rejected')
              throw new Error('Settings are invalid; product background startup was blocked.');
            if (stopping) throw new Error('Product runtime has already begun disposal or stopping.');
            await input.start({ backgroundTriggers });
          })();
          return startPromise;
        },
        subscribeRuntimeEvents: input.subscribeRuntimeEvents,
        async resume() {
          if (startPromise && !stopping) await input.recommendation.resumeBackground();
        },
        subscribeSpeechOutputEvents: input.subscribeSpeechOutputEvents,
        stop,
        dispose() {
          stopping = true;
          disposePromise ??= dispose().catch((error: unknown) => {
            disposePromise = undefined;
            throw error;
          });
          return disposePromise;
        },
      };
    },
  };
}

/** Waits for both product owners; timeout reports unfinished work without disposing resources. */
async function stopBusiness(
  owners: Pick<ApplicationBindings, 'recommendation' | 'coding'>,
  timeoutMs: number,
): Promise<void> {
  const recommendation = owners.recommendation.shutdown();
  const coding = owners.coding.shutdown();
  const work = Promise.allSettled([recommendation, coding]).then((results) => {
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'Product business shutdown failed.');
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Product business shutdown timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
