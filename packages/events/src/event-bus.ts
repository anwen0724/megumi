/*
 * In-process runtime event publisher with ordered delivery and consumer-failure isolation.
 */
import { createRuntimeDebugId, normalizeRuntimeError, type RuntimeError } from './runtime-error';
import type { RuntimeEvent } from './runtime-event';

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface PublishEventRequest { event: RuntimeEvent }
export interface SubscribeEventRequest { handler: RuntimeEventHandler }
export interface EventSubscription { unsubscribe(): void }

export interface EventPublisher {
  publish(request: PublishEventRequest): void | Promise<void>;
}

export interface EventBus extends EventPublisher {
  subscribe(request: SubscribeEventRequest): EventSubscription;
}

export interface RuntimeEventConsumerFailure {
  eventId: string;
  eventType: RuntimeEvent['eventType'];
  subscriberIndex: number;
  error: RuntimeError;
}

export interface RuntimeEventBusOptions {
  onConsumerError?: (failure: RuntimeEventConsumerFailure) => void | Promise<void>;
}

export function createRuntimeEventBus(options: RuntimeEventBusOptions = {}): EventBus {
  const handlers = new Set<RuntimeEventHandler>();

  return {
    async publish({ event }): Promise<void> {
      const subscribers = Array.from(handlers);

      for (const [subscriberIndex, handler] of subscribers.entries()) {
        try {
          await handler(event);
        } catch (error) {
          const failure: RuntimeEventConsumerFailure = {
            eventId: event.eventId,
            eventType: event.eventType,
            subscriberIndex,
            error: normalizeRuntimeError(error, {
              source: 'core',
              debugId: createRuntimeDebugId(),
              fallbackMessage: 'Runtime event consumer failed.',
            }),
          };
          try {
            await options.onConsumerError?.(failure);
          } catch {
            // Diagnostics must never change the already-published business result.
          }
        }
      }
    },
    subscribe({ handler }): EventSubscription {
      handlers.add(handler);
      return { unsubscribe: () => handlers.delete(handler) };
    },
  };
}
