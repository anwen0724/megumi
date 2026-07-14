/* Defines Session service dependencies and its stable failure shape. */
import type { SessionRepository } from '../repository/session-repository';
export type { SessionRuntimeError } from '../domain/model/session';

export type SessionServiceDependencies = {
  repository: SessionRepository;
  ids?: {
    sessionId?: () => string;
    entryId(input: { kind: 'message' | 'compaction'; source_id: string }): string;
  };
  now?: () => string;
};
