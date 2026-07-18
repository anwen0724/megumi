/*
 * In-process runtime event bus used by Agent modules and host adapters.
 * It does not persist events; business modules own any durable facts they need.
 */
import type { RuntimeEvent } from '../contracts/runtime-event-contracts';

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface RuntimeEventSubscription {
  unsubscribe(): void;
}

export interface RuntimeEventBusService {
  publish(event: RuntimeEvent): Promise<RuntimeEvent>;
  subscribe(handler: RuntimeEventHandler): RuntimeEventSubscription;
}

export function createRuntimeEventBus(): RuntimeEventBusService {
  const handlers = new Set<RuntimeEventHandler>();

  return {
    async publish(event) {
      for (const handler of Array.from(handlers)) {
        await handler(event);
      }
      return event;
    },
    subscribe(handler) {
      handlers.add(handler);
      return {
        unsubscribe() {
          handlers.delete(handler);
        },
      };
    },
  };
}
