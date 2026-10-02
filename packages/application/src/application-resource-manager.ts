/*
 * Owns application startup rollback and ordered shutdown. It records only
 * resources created by Composition and never decides module business state.
 */
import type { EventSubscription } from '@megumi/agent-runtime/events';
import type { Voice } from './voice/index';

export interface ApplicationResourceManager {
  stop(input: {
    readonly discovery: Pick<import('./discovery/index').Discovery, 'shutdown'>;
    readonly runtime: Pick<import('@megumi/agent-runtime/agent-runtime').AgentRuntime, 'stop'>;
  }): Promise<void>;
  registerDatabase(database: Pick<import('./storage/index').DatabaseConnection, 'close'>): void;
  registerEventSubscription(subscription: EventSubscription): void;
  rollbackStartup(): void;
  dispose(input: {
    readonly discovery: Pick<import('./discovery/index').Discovery, 'shutdown'>;
    readonly runtime: Pick<import('@megumi/agent-runtime/agent-runtime').AgentRuntime, 'stop'>;
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
      const execution = owners.runtime.stop({ timeoutMs: input.shutdownTimeoutMs });
      const work = Promise.allSettled([discovery, execution]).then((results) => {
        const failures: unknown[] = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        const execution = results[1];
        if (execution?.status === 'fulfilled' && execution.value?.status === 'timed_out') failures.push(new Error('Agent Execution shutdown timed out.'));
        if (failures.length) throw new AggregateError(failures, 'Product business shutdown failed.');
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([work, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Product business shutdown timed out.')), input.shutdownTimeoutMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    })();
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

    /** Attempts every shutdown step and reports all failures only after cleanup. */
    async dispose({ discovery, runtime, voice, speechOutput, observability }) {
      const failures: ProductDisposeFailure[] = [];
      try {
        await stop({ discovery, runtime });
      } catch (error) {
        failures.push({ resource: 'execution', error });
      }

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
