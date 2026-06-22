// Composes recovery control services around persisted runs and workspace restore support.
import fs from 'fs-extra';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { createChatStreamEvent } from '@megumi/shared/chat-stream';
import { RecoveryRepository } from '@megumi/desktop/main/persistence/repos/recovery.repo';
import { SessionRunRepository } from '@megumi/desktop/main/persistence/repos/session-run.repo';
import { WorkspaceChangeRepository } from '@megumi/desktop/main/persistence/repos/workspace-change.repo';
import { createRecoveryService } from '../services/runtime/recovery.service';
import { WorkspaceRestoreService } from '@megumi/coding-agent/workspace';
import type { WorkspaceChangeFooterProjectorService } from '../projections/workspace/workspace-change-footer-projector.service';
import type { ChatStreamEventSink } from '../projections/chat-stream/chat-stream-event-adapter.service';

export interface ComposeRecoveryRuntimeOptions {
  recoveryRepository: RecoveryRepository;
  sessionRunRepository: SessionRunRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  workspaceChangeFooterProjector: WorkspaceChangeFooterProjectorService;
  chatStreamSink: ChatStreamEventSink;
}

export function composeRecoveryRuntime(options: ComposeRecoveryRuntimeOptions) {
  return createRecoveryService({
    repository: options.recoveryRepository,
    clock: () => new Date(),
    ids: {
      resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
      cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
      retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
      eventId: () => `event:${crypto.randomUUID()}`,
      interruptedMarkerId: (runId) => `interrupted-marker:${runId}:${crypto.randomUUID()}`,
    },
    workspaceChanges: options.workspaceChangeRepository,
    workspaceRestore: {
      restoreChangeSet(input) {
        return createWorkspaceRestoreForChangeSet({
          changeSetId: input.changeSetId,
          sessionRunRepository: options.sessionRunRepository,
          workspaceChangeRepository: options.workspaceChangeRepository,
        }).restoreChangeSet(input);
      },
    },
    appendRuntimeEvent: (event) => {
      options.sessionRunRepository.appendRuntimeEvent(event);
    },
    publishWorkspaceChangeFooter: (runId, createdAt) => {
      const footer = options.workspaceChangeFooterProjector.projectRunFooter(runId);
      const run = options.sessionRunRepository.getRun(runId);
      const session = run ? options.sessionRunRepository.getSession(String(run.sessionId)) : undefined;
      if (!footer || !run || !session) {
        return;
      }

      options.chatStreamSink.publish(createChatStreamEvent({
        eventId: `chat-stream-event:${crypto.randomUUID()}`,
        eventType: 'workspace.change.footer.updated',
        projectId: String(session.workspaceId ?? session.sessionId),
        sessionId: String(session.sessionId),
        runId,
        streamId: `chat-stream:${runId}:workspace-change-footer`,
        streamKind: 'workspace-change-footer',
        seq: 1,
        createdAt,
        footer,
      }));
    },
    nextRuntimeSequence: (runId) => nextPersistedRuntimeSequence(
      options.sessionRunRepository.listRuntimeEventsByRun(runId),
    ),
  });
}

function createWorkspaceRestoreForChangeSet(input: {
  changeSetId: string;
  sessionRunRepository: SessionRunRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
}): WorkspaceRestoreService {
  const changeSet = input.workspaceChangeRepository.getChangeSet(input.changeSetId);
  if (!changeSet) {
    throw new Error(`Workspace change set not found: ${input.changeSetId}`);
  }

  const run = input.sessionRunRepository.getRun(changeSet.runId);
  if (!run) {
    throw new Error(`Workspace restore requires run: ${changeSet.runId}`);
  }

  const session = input.sessionRunRepository.getSession(String(run.sessionId));
  if (!session?.workspacePath) {
    throw new Error(`Workspace restore requires workspacePath for session: ${run.sessionId}`);
  }

  return new WorkspaceRestoreService({
    projectRoot: session.workspacePath,
    fileSystem: fs,
    repository: input.workspaceChangeRepository,
    ids: {
      restoreRequestId: () => `workspace-restore-request:${crypto.randomUUID()}`,
      restoreResultId: () => `workspace-restore-result:${crypto.randomUUID()}`,
      restoreFileResultId: () => `workspace-restore-file-result:${crypto.randomUUID()}`,
    },
  });
}

function nextPersistedRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((maxSequence, event) => Math.max(maxSequence, event.sequence), 0) + 1;
}
