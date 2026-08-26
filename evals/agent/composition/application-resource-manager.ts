/*
 * Owns application startup rollback and ordered shutdown. It records only
 * resources created by Composition and never decides module business state.
 */
import type { Discovery } from '@megumi/discovery';
import type { AgentExecutions, ConversationSubmission } from '@megumi/execution';
import type { DatabaseConnection } from '@megumi/database';
import type { EventSubscription } from '@megumi/events';
import type { Voice } from '@megumi/voice';

export interface ApplicationResourceManager {
  registerDatabase(database: DatabaseConnection): void;
  registerEventSubscription(subscription: EventSubscription): void;
  rollbackStartup(): void;
  dispose(input: {
    readonly discovery: Discovery;
    readonly executions: AgentExecutions;
    readonly conversation: ConversationSubmission;
    readonly voice: Voice;
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
  let database: DatabaseConnection | undefined;
  const eventSubscriptions: EventSubscription[] = [];

  return {
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
    async dispose({ discovery, executions, conversation, voice, speechOutput, observability }) {
      const failures: ProductDisposeFailure[] = [];
      const discoveryShutdown = (async () => {
        try {
          await discovery.shutdown();
        } catch (error) {
          failures.push({ resource: 'discovery', error });
        }
      })();
      try {
        const result = await executions.shutdown({ timeoutMs: input.shutdownTimeoutMs });
        if (result.status === 'timed_out') {
          failures.push({
            resource: 'execution',
            error: new Error(`Agent Execution shutdown timed out with ${result.activeExecutions.length} active execution(s).`),
          });
        }
      } catch (error) {
        failures.push({ resource: 'execution', error });
      }
      try {
        await conversation.shutdown();
      } catch (error) {
        failures.push({ resource: 'conversation', error });
      }
      await discoveryShutdown;

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
