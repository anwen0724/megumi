/*
 * The event bus: the single entry point for every runtime event.
 *
 * Producers publish the facts they know (type, payload, ownership); the bus
 * fills the protocol fields — id, session-monotonic sequence, createdAt — so
 * producers never coordinate. Subscribers declare what they care about
 * (sessionId / runId / eventTypes) and receive only matching events, in the
 * order the bus received them.
 *
 * Delivery is best-effort by design (see CONTEXT.md): a failing subscriber is
 * isolated and reported as a diagnostic; it never affects the run that
 * produced the event.
 */

import type { AnyEvent, Event, EventPayloadByType, EventType } from './event';

export interface PublishEventInput {
  readonly type: EventType;
  readonly payload: EventPayloadByType[EventType];
  /** Required ownership root. */
  readonly sessionId: string;
  /** Optional: the run the event happened in. */
  readonly runId?: string;
  /** Optional override; the bus assigns a unique id when omitted. */
  readonly id?: string;
  /** Optional override; the bus stamps createdAt when omitted. */
  readonly createdAt?: string;
}

export interface EventFilter {
  /** Receive only events of this session. */
  readonly sessionId?: string;
  /** Receive only events of this run. */
  readonly runId?: string;
  /** Receive only these event types. Dimensions are intersected. */
  readonly eventTypes?: readonly EventType[];
}

export type EventHandler = (event: AnyEvent) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe(): void;
}

export interface EventBus {
  /** Publish a fact; protocol fields are filled by the bus. */
  publish(input: PublishEventInput): void;
  /** Subscribe with an optional filter; returns an unsubscribe handle. */
  subscribe(filter: EventFilter, handler: EventHandler): EventSubscription;
}

export interface ConsumerFailure {
  readonly eventType: EventType;
  readonly sessionId: string;
  readonly sequence: number;
  readonly error: unknown;
}

export interface CreateEventBusOptions {
  /** id generator; defaults to a random id. */
  id?: () => string;
  /** Clock; defaults to ISO now. */
  now?: () => string;
  /** Receives each isolated consumer failure for diagnostics. */
  onConsumerError?: (failure: ConsumerFailure) => void | Promise<void>;
}

interface RegisteredSubscriber {
  readonly filter: EventFilter;
  readonly handler: EventHandler;
}

export function createEventBus(options: CreateEventBusOptions = {}): EventBus {
  const id = options.id ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const subscribers = new Set<RegisteredSubscriber>();
  // One counter per session: sequence is session-monotonic, never global.
  const sessionCounters = new Map<string, number>();

  return {
    publish(input: PublishEventInput): void {
      const sequence = (sessionCounters.get(input.sessionId) ?? 0) + 1;
      sessionCounters.set(input.sessionId, sequence);
      const event = {
        id: input.id ?? id(),
        type: input.type,
        payload: input.payload,
        sessionId: input.sessionId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        sequence,
        createdAt: input.createdAt ?? now(),
      } as AnyEvent;

      const report = (error: unknown): void => {
        try {
          void options.onConsumerError?.({
            eventType: event.type,
            sessionId: event.sessionId,
            sequence,
            error,
          });
        } catch {
          // Diagnostics must never change the already-published result.
        }
      };

      // Snapshot the subscribers: one added mid-delivery does not join this round.
      for (const subscriber of Array.from(subscribers)) {
        if (!matches(subscriber.filter, event)) continue;
        // Best-effort delivery: a broken subscriber (sync throw or async
        // rejection) must not stall the others nor surface to the producer.
        try {
          const result = subscriber.handler(event);
          if (result instanceof Promise) {
            void result.catch((error) => report(error));
          }
        } catch (error) {
          report(error);
        }
      }
    },

    subscribe(filter: EventFilter, handler: EventHandler): EventSubscription {
      const subscriber: RegisteredSubscriber = { filter, handler };
      subscribers.add(subscriber);
      return { unsubscribe: () => { subscribers.delete(subscriber); } };
    },
  };
}

function matches(filter: EventFilter, event: Event): boolean {
  if (filter.sessionId !== undefined && filter.sessionId !== event.sessionId) return false;
  if (filter.runId !== undefined && filter.runId !== event.runId) return false;
  if (filter.eventTypes !== undefined && !filter.eventTypes.includes(event.type)) return false;
  return true;
}
