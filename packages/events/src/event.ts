/*
 * Runtime event envelope.
 *
 * An Event is a settled fact of one run: immutable, ordered, and told exactly
 * once to every subscriber that asks for it. The envelope carries only what
 * broadcast demands (who it belongs to) plus what ordering demands (sequence);
 * every other fact lives in the payload, which each lifecycle layer owns.
 *
 * Layer files (run.ts, turn.ts, message.ts, tool.ts, approval.ts, session.ts)
 * own their event types and payload shapes; this module only assembles them.
 */

import type { ApprovalEventPayloadByType } from './approval';
import type { MessageEventPayloadByType } from './message';
import type { RunEventPayloadByType } from './run';
import type { SessionEventPayloadByType } from './session';
import type { ToolEventPayloadByType } from './tool';
import type { TurnEventPayloadByType } from './turn';

/** Every event type, assembled from the lifecycle layers. */
export type EventPayloadByType = RunEventPayloadByType
  & TurnEventPayloadByType
  & MessageEventPayloadByType
  & ToolEventPayloadByType
  & ApprovalEventPayloadByType
  & SessionEventPayloadByType;

export type EventType = keyof EventPayloadByType;

/**
 * A broadcast event. `id`/`sequence`/`createdAt` are protocol fields supplied
 * by the bus; producers only provide type, payload, and ownership.
 */
export interface Event<TType extends EventType = EventType> {
  /** Globally unique, assigned by the bus (deduplication key). */
  readonly id: string;
  readonly type: TType;
  readonly payload: EventPayloadByType[TType];
  /** Required ownership root: every event belongs to exactly one session. */
  readonly sessionId: string;
  /** Optional: which run the event happened in (session-scoped events omit it). */
  readonly runId?: string;
  /** Session-monotonic order assigned by the bus — the authority for sorting. */
  readonly sequence: number;
  /** Display time; never used for ordering (clocks may drift). */
  readonly createdAt: string;
}

/**
 * The discriminated union of every event kind: narrowing on `type` narrows
 * `payload` too. Consumers that dispatch on event type use this instead of the
 * generic `Event`.
 */
export type AnyEvent = { [TType in EventType]: Event<TType> }[EventType];
