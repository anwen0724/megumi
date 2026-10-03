/*
 * Owns application startup rollback and ordered shutdown. It records only
 * resources created by Composition and never decides module business state.
 */
import type { EventSubscription } from './application';
import type { Voice } from './voice/index';

export interface ApplicationResourceManager {
  stop(input: {
    readonly discovery: Pick<import('./recommendation/recommendation-api').Discovery, 'shutdown'>;
    readonly coding: Pick<import('./coding/submit-message').Coding, 'shutdown'>;
  }): Promise<void>;
  registerDatabase(database: Pick<import('./storage/index').DatabaseConnection, 'close'>): void;
  registerEventSubscription(subscription: EventSubscription): void;
  rollbackStartup(): void;
  dispose(input: {
    readonly discovery: Pick<import('./recommendation/recommendation-api').Discovery, 'shutdown'>;
    readonly coding: Pick<import('./coding/submit-message').Coding, 'shutdown'>;
    readonly voice: Pick<Voice, 'dispose'>;
    readonly speechOutput: { dispose(): void };
    readonly observability: { shutdown(): Promise<void> };
  }): Promise<void>;
}

interface ProductDisposeFailure {
  readonly resource:
  | 'discovery'
  | 'execution'
  | 'conversation'
  | 'voice'
  | 'speech-output'
  | 'events'
  | 'observability'
  | 'database';
  readonly error: unknown;
}

/** Creates the single lifecycle owner used throughout one Product composition. */
export function createApplicationResourceManager(input: {
  readonly shutdownTimeoutMs: number;
}): ApplicationResourceManager {
  let database: Pick<import('./storage/index').DatabaseConnection, 'close'> | undefined;
  const eventSubscriptions: EventSubscription[] = [];
  let stopPromise: Promise<void> | undefined;
  const stop: ApplicationResourceManager['stop'] = (owners) => {
    stopPromise ??= (async () => {
      const discovery = owners.discovery.shutdown();
      const execution = owners.coding.shutdown();
      const work = Promise.allSettled([discovery, execution]).then((results) => {
        const failures: unknown[] = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        if (failures.length) throw new AggregateError(failures, 'Product business shutdown failed.');
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([work, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Product business shutdown timed out.')), input.shutdownTimeoutMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    })().catch((error: unknown) => {
      stopPromise = undefined;
      throw error;
    });
    return stopPromise;
  };

  return {
    stop,
    registerDatabase(resource) {
      database = resource;
    },

    registerEventSubscription(subscription) {
      eventSubscriptions.push(subscription);
    },

    /** Releases partially created resources while preserving the startup error. */
    rollbackStartup() {
      for (const subscription of [...eventSubscriptions].reverse()) {
        try {
          subscription.unsubscribe();
        } catch {
          // Startup rollback must not replace the original composition failure.
        }
      }
      if (!database) return;
      try {
        database.close();
      } catch {
        // Startup rollback must not replace the original composition failure.
      }
    },

    /** Releases dependent resources only after business work has actually stopped. */
    async dispose({ discovery, coding, voice, speechOutput, observability }) {
      await stop({ discovery, coding });
      const failures: ProductDisposeFailure[] = [];

      try {
        await voice.dispose();
      } catch (error) {
        failures.push({ resource: 'voice', error });
      }

      try {
        speechOutput.dispose();
      } catch (error) {
        failures.push({ resource: 'speech-output', error });
      }

      for (const subscription of eventSubscriptions) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          failures.push({ resource: 'events', error });
        }
      }
      try {
        await observability.shutdown();
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
    },
  };
}
