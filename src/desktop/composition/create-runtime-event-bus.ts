// Provides a small in-process event bus for AgentRuntimeEvent subscriptions.
import type { AgentRuntimeEvent } from '../../app';

export type RuntimeEventSubscriber = (event: AgentRuntimeEvent) => void;

export interface RuntimeEventBus {
  publish(event: AgentRuntimeEvent): void;
  subscribe(callback: RuntimeEventSubscriber): () => void;
}

export function createRuntimeEventBus(): RuntimeEventBus {
  const subscribers = new Set<RuntimeEventSubscriber>();
  return {
    publish(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
}
