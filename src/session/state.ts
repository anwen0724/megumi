// Owns session state transitions while persistence is delegated through SessionStateRepository.
import type { JsonObject, JsonValue } from '../shared';
import type { BranchMarker } from './branch';
import {
  createSessionEntityId,
  type BranchMarkerId,
  type RetryAttemptId,
  type SessionId,
  type SessionIdPrefix,
  type SessionMessageId,
  type SessionRunId,
  type SessionSourceEntryId,
} from './ids';
import type { SessionMessageRole } from './message';
import type { SessionStateRepository } from './repository';
import type { SessionRunRecord, SessionRunStatus } from './run-history';
import type { Session } from './session';
import type { SessionSourceEntry } from './source-entry';

export interface SessionStateManagerDependencies {
  repository: SessionStateRepository;
  now?: () => string;
  createId?: (prefix: SessionIdPrefix, value: string) => string;
}

export interface CreateSessionInput {
  idSeed: string;
  title: string;
  workspaceId?: string;
  workspacePath?: string;
  metadata?: JsonObject;
}

export interface AppendMessageInput {
  idSeed: string;
  sourceEntryIdSeed: string;
  sessionId: SessionId | string;
  role: SessionMessageRole;
  content: JsonValue;
  metadata?: JsonObject;
}

export interface CreateBranchInput {
  idSeed: string;
  sessionId: SessionId | string;
  fromSourceEntryId: SessionSourceEntryId | string;
  label?: string;
  metadata?: JsonObject;
}

export interface RecordRetryAttemptInput {
  idSeed: string;
  sourceEntryIdSeed: string;
  sessionId: SessionId | string;
  targetSourceEntryId: SessionSourceEntryId | string;
  attemptNumber: number;
  metadata?: JsonObject;
}

export interface RecordRunInput {
  idSeed: string;
  sourceEntryIdSeed: string;
  sessionId: SessionId | string;
  inputSummary: string;
  status: SessionRunStatus;
  metadata?: JsonObject;
}

export interface RecordRerunInput {
  idSeed: string;
  sourceEntryIdSeed: string;
  sessionId: SessionId | string;
  targetRunId?: SessionRunId | string;
  targetSourceEntryId?: SessionSourceEntryId | string;
  attemptNumber: number;
  metadata?: JsonObject;
}

export interface UpdateRunStatusInput {
  runId: SessionRunId | string;
  status: SessionRunStatus;
  endedAt?: string;
  error?: JsonObject;
  metadata?: JsonObject;
}

export function createSessionStateManager(dependencies: SessionStateManagerDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const makeId = dependencies.createId ?? ((prefix, value) => createSessionEntityId(prefix, value));

  return {
    createSession(input: CreateSessionInput): Session {
      const timestamp = now();
      const session: Session = {
        id: makeId('session', input.idSeed) as SessionId,
        title: input.title,
        status: 'active',
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: input.metadata,
      };

      return dependencies.repository.createSession(session);
    },

    appendMessage(input: AppendMessageInput) {
      return dependencies.repository.transaction(() => {
        const timestamp = now();
        const activeLeaf = dependencies.repository.getActiveLeaf(input.sessionId);
        const message = dependencies.repository.insertMessage({
          id: makeId('session-message', input.idSeed) as SessionMessageId,
          sessionId: input.sessionId as SessionId,
          role: input.role,
          content: input.content,
          createdAt: timestamp,
          metadata: input.metadata,
        });
        const sourceEntry = dependencies.repository.insertSourceEntry({
          id: makeId('session-source-entry', input.sourceEntryIdSeed) as SessionSourceEntryId,
          sessionId: input.sessionId as SessionId,
          parentId: activeLeaf?.id,
          kind: 'message',
          ref: { type: 'message', messageId: message.id },
          createdAt: timestamp,
        });

        dependencies.repository.setActiveLeaf(input.sessionId, sourceEntry.id);
        return { message, sourceEntry };
      });
    },

    createBranch(input: CreateBranchInput): { marker: BranchMarker } {
      return dependencies.repository.transaction(() => {
        const timestamp = now();
        const markerId = makeId('branch-marker', input.idSeed) as BranchMarkerId;
        const branchFrom = requireSourceEntryInSession({
          repository: dependencies.repository,
          sessionId: input.sessionId,
          sourceEntryId: input.fromSourceEntryId,
        });
        const marker = dependencies.repository.insertBranchMarker({
          id: markerId,
          sessionId: input.sessionId as SessionId,
          sourceEntryId: branchFrom.id,
          fromSourceEntryId: branchFrom.id,
          label: input.label,
          createdAt: timestamp,
          metadata: input.metadata,
        });

        dependencies.repository.setActiveLeaf(input.sessionId, branchFrom.id);
        return { marker };
      });
    },

    recordRetryAttempt(input: RecordRetryAttemptInput) {
      return dependencies.repository.transaction(() => {
        const timestamp = now();
        const targetSourceEntry = requireSourceEntryInSession({
          repository: dependencies.repository,
          sessionId: input.sessionId,
          sourceEntryId: input.targetSourceEntryId,
        });
        const attemptId = makeId('retry-attempt', input.idSeed) as RetryAttemptId;
        const sourceEntry = dependencies.repository.insertSourceEntry({
          id: makeId('session-source-entry', input.sourceEntryIdSeed) as SessionSourceEntryId,
          sessionId: input.sessionId as SessionId,
          parentId: targetSourceEntry.id,
          kind: 'retry',
          ref: { type: 'retry', retryAttemptId: attemptId },
          createdAt: timestamp,
          metadata: input.metadata,
        });
        const attempt = dependencies.repository.insertRetryAttempt({
          id: attemptId,
          sessionId: input.sessionId as SessionId,
          sourceEntryId: sourceEntry.id,
          targetSourceEntryId: targetSourceEntry.id,
          mode: 'retry',
          attemptNumber: input.attemptNumber,
          createdAt: timestamp,
          metadata: input.metadata,
        });

        dependencies.repository.setActiveLeaf(input.sessionId, sourceEntry.id);
        return { attempt, sourceEntry };
      });
    },

    recordRerun(input: RecordRerunInput) {
      return dependencies.repository.transaction(() => {
        const timestamp = now();
        const targetSourceEntry = resolveRerunTargetSourceEntry({
          repository: dependencies.repository,
          sessionId: input.sessionId,
          targetRunId: input.targetRunId,
          targetSourceEntryId: input.targetSourceEntryId,
        });
        const attemptId = makeId('retry-attempt', input.idSeed) as RetryAttemptId;
        const sourceEntry = dependencies.repository.insertSourceEntry({
          id: makeId('session-source-entry', input.sourceEntryIdSeed) as SessionSourceEntryId,
          sessionId: input.sessionId as SessionId,
          parentId: targetSourceEntry.id,
          kind: 'rerun',
          ref: { type: 'rerun', retryAttemptId: attemptId },
          createdAt: timestamp,
          metadata: input.metadata,
        });
        const attempt = dependencies.repository.insertRetryAttempt({
          id: attemptId,
          sessionId: input.sessionId as SessionId,
          sourceEntryId: sourceEntry.id,
          targetSourceEntryId: targetSourceEntry.id,
          mode: 'rerun',
          attemptNumber: input.attemptNumber,
          createdAt: timestamp,
          metadata: input.metadata,
        });

        dependencies.repository.setActiveLeaf(input.sessionId, sourceEntry.id);
        return { attempt, sourceEntry };
      });
    },

    recordRun(input: RecordRunInput) {
      return dependencies.repository.transaction(() => {
        const timestamp = now();
        const activeLeaf = dependencies.repository.getActiveLeaf(input.sessionId);
        const runId = makeId('session-run', input.idSeed) as SessionRunId;
        const sourceEntry = dependencies.repository.insertSourceEntry({
          id: makeId('session-source-entry', input.sourceEntryIdSeed) as SessionSourceEntryId,
          sessionId: input.sessionId as SessionId,
          parentId: activeLeaf?.id,
          kind: 'run',
          ref: { type: 'run', runId },
          createdAt: timestamp,
          metadata: input.metadata,
        });
        const run = dependencies.repository.insertRunRecord({
          id: runId,
          sessionId: input.sessionId as SessionId,
          sourceEntryId: sourceEntry.id,
          inputSummary: input.inputSummary,
          status: input.status,
          startedAt: timestamp,
          metadata: input.metadata,
        });

        dependencies.repository.setActiveLeaf(input.sessionId, sourceEntry.id);
        return { run, sourceEntry };
      });
    },

    updateRunStatus(input: UpdateRunStatusInput): SessionRunRecord {
      const current = dependencies.repository.getRunRecord(input.runId);
      if (!current) {
        throw new Error(`Session run not found: ${String(input.runId)}`);
      }

      return dependencies.repository.updateRunRecord({
        ...current,
        status: input.status,
        endedAt: input.endedAt,
        error: input.error,
        metadata: input.metadata ?? current.metadata,
      });
    },

    getActivePath(sessionId: SessionId | string): SessionSourceEntry[] {
      return dependencies.repository.getActivePath(sessionId);
    },
  };
}

function resolveRerunTargetSourceEntry(input: {
  repository: SessionStateRepository;
  sessionId: SessionId | string;
  targetRunId?: SessionRunId | string;
  targetSourceEntryId?: SessionSourceEntryId | string;
}): SessionSourceEntry {
  if (input.targetSourceEntryId) {
    return requireSourceEntryInSession({
      repository: input.repository,
      sessionId: input.sessionId,
      sourceEntryId: input.targetSourceEntryId,
    });
  }

  if (!input.targetRunId) {
    throw new Error('Rerun targetRunId or targetSourceEntryId is required');
  }

  const runId = String(input.targetRunId);
  const sessionId = String(input.sessionId);
  const run = input.repository.getRunRecord(input.targetRunId);

  if (!run) {
    throw new Error(`Session run not found: ${runId}`);
  }

  if (String(run.sessionId) !== sessionId) {
    throw new Error(`Session run ${runId} belongs to ${run.sessionId}, not ${sessionId}`);
  }

  return requireSourceEntryInSession({
    repository: input.repository,
    sessionId: input.sessionId,
    sourceEntryId: run.sourceEntryId,
  });
}

function requireSourceEntryInSession(input: {
  repository: SessionStateRepository;
  sessionId: SessionId | string;
  sourceEntryId: SessionSourceEntryId | string;
}): SessionSourceEntry {
  const sourceEntryId = String(input.sourceEntryId);
  const sessionId = String(input.sessionId);
  const sourceEntry = input.repository.getSourceEntry(input.sourceEntryId);

  if (!sourceEntry) {
    throw new Error(`Session source entry not found: ${sourceEntryId}`);
  }

  if (String(sourceEntry.sessionId) !== sessionId) {
    throw new Error(`Session source entry ${sourceEntryId} belongs to ${sourceEntry.sessionId}, not ${sessionId}`);
  }

  return sourceEntry;
}
