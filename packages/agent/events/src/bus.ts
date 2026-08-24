/*
 * The event bus: the single entry point for every runtime event.
 *
 * Producers publish the facts they know (type, payload, ownership); the bus
 * fills the protocol fields — id, session-monotonic sequence, createdAt — so
 * producers never coordinate. Subscribers declare what they care about
 * (sessionId / executionId / eventTypes) and receive only matching events, in the
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
  readonly executionId?: string;
  /** Optional override; the bus assigns a unique id when omitted. */
  readonly id?: string;
  /** Optional override; the bus stamps createdAt when omitted. */
  readonly createdAt?: string;
}

export interface EventFilter {
  /** Receive only events of this session. */
  readonly sessionId?: string;
  /** Receive only events of this run. */
  readonly executionId?: string;
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
  /** Read the currently retained event range for one Session without affecting delivery order. */
  read(request: ReadEventsRequest): ReadEventsResult;
}

export interface ReadEventsRequest {
  readonly sessionId: string;
  readonly afterSequence?: number;
}

export interface ReadEventsResult {
  readonly events: readonly AnyEvent[];
  readonly firstSequence?: number;
  readonly lastSequence?: number;
  readonly truncated: boolean;
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
  /** Bounds the in-process replay window without changing immediate delivery. */
  recentEvents?: RecentEventBufferOptions;
}

export interface RecentEventBufferOptions {
  readonly maxSessions: number;
  readonly maxEventsPerSession: number;
}

interface RegisteredSubscriber {
  readonly filter: EventFilter;
  readonly handler: EventHandler;
}

const DEFAULT_RECENT_EVENT_BUFFER: RecentEventBufferOptions = {
  maxSessions: 64,
  maxEventsPerSession: 1_024,
};

export function createEventBus(options: CreateEventBusOptions = {}): EventBus {
  const id = options.id ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const subscribers = new Set<RegisteredSubscriber>();
  // One counter per session: sequence is session-monotonic, never global.
  const sessionCounters = new Map<string, number>();
  const recentEventPolicy = validateRecentEventPolicy(
    options.recentEvents ?? DEFAULT_RECENT_EVENT_BUFFER,
  );
  // Map insertion order is the payload LRU. read() intentionally never refreshes it.
  const recentEventsBySession = new Map<string, RecentEventBuffer>();

  return {
    publish(input: PublishEventInput): void {
      const sequence = (sessionCounters.get(input.sessionId) ?? 0) + 1;
      sessionCounters.set(input.sessionId, sequence);
      const event = {
        id: input.id ?? id(),
        type: input.type,
        payload: input.payload,
        sessionId: input.sessionId,
        ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
        sequence,
        createdAt: input.createdAt ?? now(),
      } as AnyEvent;

      retainRecentEvent(
        recentEventsBySession,
        recentEventPolicy,
        event,
      );

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

    read(request: ReadEventsRequest): ReadEventsResult {
      validateReadRequest(request);
      const buffer = recentEventsBySession.get(request.sessionId);
      if (!buffer) {
        return sessionCounters.has(request.sessionId)
          ? { events: [], truncated: true }
          : { events: [], truncated: false };
      }
      const retained = buffer.values();
      const firstSequence = retained[0]?.sequence;
      const lastSequence = retained.at(-1)?.sequence;
      const requestedFirstSequence = request.afterSequence === undefined
        ? 1
        : request.afterSequence + 1;
      const events = retained.filter((event) => (
        request.afterSequence === undefined || event.sequence > request.afterSequence
      ));
      return {
        events: structuredClone(events),
        ...(firstSequence === undefined ? {} : { firstSequence }),
        ...(lastSequence === undefined ? {} : { lastSequence }),
        truncated: firstSequence !== undefined && requestedFirstSequence < firstSequence,
      };
    },
  };
}

/** Fixed-capacity ring buffer keeps publish append and oldest-event trimming constant-time. */
class RecentEventBuffer {
  private readonly entries: Array<AnyEvent | undefined>;
  private start = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.entries = new Array<AnyEvent | undefined>(capacity);
  }

  append(event: AnyEvent): void {
    const stored = structuredClone(event);
    if (this.size < this.capacity) {
      this.entries[(this.start + this.size) % this.capacity] = stored;
      this.size += 1;
      return;
    }
    this.entries[this.start] = stored;
    this.start = (this.start + 1) % this.capacity;
  }

  values(): readonly AnyEvent[] {
    const values: AnyEvent[] = [];
    for (let index = 0; index < this.size; index += 1) {
      const event = this.entries[(this.start + index) % this.capacity];
      if (event) values.push(event);
    }
    return values;
  }
}

/** Retains payloads by publish recency while sessionCounters keep gap metadata after eviction. */
function retainRecentEvent(
  buffers: Map<string, RecentEventBuffer>,
  policy: RecentEventBufferOptions,
  event: AnyEvent,
): void {
  let buffer = buffers.get(event.sessionId);
  if (!buffer) {
    if (buffers.size >= policy.maxSessions) {
      const oldestSessionId = buffers.keys().next().value as string | undefined;
      if (oldestSessionId !== undefined) buffers.delete(oldestSessionId);
    }
    buffer = new RecentEventBuffer(policy.maxEventsPerSession);
  } else {
    buffers.delete(event.sessionId);
  }
  buffer.append(event);
  buffers.set(event.sessionId, buffer);
}

function validateRecentEventPolicy(policy: RecentEventBufferOptions): RecentEventBufferOptions {
  if (!Number.isInteger(policy.maxSessions) || policy.maxSessions <= 0) {
    throw new TypeError('recentEvents.maxSessions must be a positive integer.');
  }
  if (!Number.isInteger(policy.maxEventsPerSession) || policy.maxEventsPerSession <= 0) {
    throw new TypeError('recentEvents.maxEventsPerSession must be a positive integer.');
  }
  return { ...policy };
}

function validateReadRequest(request: ReadEventsRequest): void {
  if (request.sessionId.trim().length === 0) {
    throw new TypeError('sessionId must be a non-empty string.');
  }
  if (
    request.afterSequence !== undefined
    && (!Number.isInteger(request.afterSequence) || request.afterSequence < 0)
  ) {
    throw new TypeError('afterSequence must be a non-negative integer.');
  }
}

function matches(filter: EventFilter, event: Event): boolean {
  if (filter.sessionId !== undefined && filter.sessionId !== event.sessionId) return false;
  if (filter.executionId !== undefined && filter.executionId !== event.executionId) return false;
  if (filter.eventTypes !== undefined && !filter.eventTypes.includes(event.type)) return false;
  return true;
}
