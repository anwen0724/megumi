// Defines session-owned identifier types and factory helpers for persisted session facts.
import { createId, type EntityId } from '../shared';

export type SessionId = EntityId<'session'>;
export type SessionMessageId = EntityId<'session-message'>;
export type SessionSourceEntryId = EntityId<'session-source-entry'>;
export type BranchMarkerId = EntityId<'branch-marker'>;
export type RetryAttemptId = EntityId<'retry-attempt'>;
export type SessionRunId = EntityId<'session-run'>;

export type SessionIdPrefix =
  | 'session'
  | 'session-message'
  | 'session-source-entry'
  | 'branch-marker'
  | 'retry-attempt'
  | 'session-run';

export function createSessionEntityId(prefix: 'session', value: string): SessionId;
export function createSessionEntityId(prefix: 'session-message', value: string): SessionMessageId;
export function createSessionEntityId(prefix: 'session-source-entry', value: string): SessionSourceEntryId;
export function createSessionEntityId(prefix: 'branch-marker', value: string): BranchMarkerId;
export function createSessionEntityId(prefix: 'retry-attempt', value: string): RetryAttemptId;
export function createSessionEntityId(prefix: 'session-run', value: string): SessionRunId;
export function createSessionEntityId(prefix: SessionIdPrefix, value: string): EntityId<string>;
export function createSessionEntityId(prefix: SessionIdPrefix, value: string): EntityId<string> {
  return createId(prefix, value);
}
