// Composes the Coding Agent product recovery runtime without desktop UI projections.
import fs from 'fs-extra';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { RecoveryRepository } from '../persistence/repos/recovery.repo';
import { RunRecordRepository } from '../persistence/repos/run-record.repo';
import { RuntimeEventRepository } from '../persistence/repos/runtime-event.repo';
import { SessionRecordRepository } from '../persistence/repos/session-record.repo';
import { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import { TimelineMessageRepository } from '../persistence/repos/timeline-message.repo';
import { createRecoveryService, type RecoveryLogger } from '../run/recovery';
import { WorkspaceRestoreService } from '../workspace';
import type { AgentRunService } from '../run/agent-run-service';

export interface ComposeCodingAgentRecoveryRuntimeOptions {
  recoveryRepository: RecoveryRepository;
  runRepository: RunRecordRepository;
  sessionRepository: SessionRecordRepository;
  runtimeEventRepository: RuntimeEventRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  timelineMessageRepository: TimelineMessageRepository;
  sessionRunService: AgentRunService;
  logger?: RecoveryLogger;
}

export function composeCodingAgentRecoveryRuntime(options: ComposeCodingAgentRecoveryRuntimeOptions) {
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
    timelineBackfill: {
      listRunsNeedingTimelineBackfill: () => options.recoveryRepository.listRunsNeedingTimelineBackfill(),
      hasCommittedTimeline: (runId) => Boolean(options.timelineMessageRepository.getRunCommit(runId)),
      commitRunTimeline: (input) => options.timelineMessageRepository.commitRunTimeline(input),
    },
    ...(options.logger ? { logger: options.logger } : {}),
    workspaceRestore: {
      restoreChangeSet(input) {
        return createWorkspaceRestoreForChangeSet({
          changeSetId: input.changeSetId,
          runRepository: options.runRepository,
          sessionRepository: options.sessionRepository,
          workspaceChangeRepository: options.workspaceChangeRepository,
        }).restoreChangeSet(input);
      },
    },
    appendRuntimeEvent: (event) => {
      options.runtimeEventRepository.appendRuntimeEvent(event);
    },
    publishWorkspaceChangeFooter: (runId, createdAt) => {
      // Workspace change footer publishing is a UI projection concern.
      // Desktop should provide this through the chat stream event sink.
    },
    nextRuntimeSequence: (runId) => nextPersistedRuntimeSequence(
      options.runtimeEventRepository.listRuntimeEventsByRun(runId),
    ),
  });
}

function createWorkspaceRestoreForChangeSet(input: {
  changeSetId: string;
  runRepository: Pick<RunRecordRepository, 'getRun'>;
  sessionRepository: Pick<SessionRecordRepository, 'getSession'>;
  workspaceChangeRepository: WorkspaceChangeRepository;
}): WorkspaceRestoreService {
  const changeSet = input.workspaceChangeRepository.getChangeSet(input.changeSetId);
  if (!changeSet) {
    throw new Error(`Workspace change set not found: ${input.changeSetId}`);
  }

  const run = input.runRepository.getRun(changeSet.runId);
  if (!run) {
    throw new Error(`Workspace restore requires run: ${changeSet.runId}`);
  }

  const session = input.sessionRepository.getSession(String(run.sessionId));
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
