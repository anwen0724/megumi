// Composes the Coding Agent product recovery runtime without desktop UI projections.
import type { JsonValue } from '@megumi/shared/primitives';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { WorkspaceRestoreData, WorkspaceRestorePayload } from '@megumi/shared/ipc';
import type { TimelineMessage } from '@megumi/shared/timeline';
import type { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import type { SessionRepository } from '../persistence/repos/session.repo';
import { WorkspaceChangeRepository } from '../workspace/repositories/workspace-change-repository';
import { createRecoveryService, type RecoveryLogger } from '../state';

export interface ComposeCodingAgentRecoveryRuntimeOptions {
  recoveryRepository: AgentLoopRepository;
  runRepository: AgentLoopRepository;
  sessionRepository: SessionRepository;
  runtimeEventRepository: AgentLoopRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  timelineMessageRepository: AgentLoopRepository;
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
    timelineBackfill: {
      listRunsNeedingTimelineBackfill: () => options.recoveryRepository.listRunsNeedingTimelineBackfill(),
      hasCommittedTimeline: (runId) => Boolean(options.timelineMessageRepository.getRunCommit(runId)),
      commitRunTimeline: (input) => {
        const committed = options.timelineMessageRepository.commitRunTimeline(input);
        for (const message of input.messages) {
          if (message.role !== 'assistant') {
            continue;
          }
          options.sessionRepository.saveMessage({
            messageId: String(message.messageId),
            sessionId: input.sessionId,
            runId: input.runId,
            role: 'assistant',
            content: timelineMessageText(message),
            status: 'completed',
            createdAt: message.createdAt,
            completedAt: message.updatedAt,
            metadata: { timelineMessage: message as unknown as JsonValue },
          });
        }
        return committed;
      },
    },
    ...(options.logger ? { logger: options.logger } : {}),
    workspaceRestore: {
      restoreChangeSet: unsupportedWorkspaceRestore,
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

function timelineMessageText(message: TimelineMessage): string {
  return message.blocks
    .map((block) => {
      if ('text' in block && typeof block.text === 'string') {
        return block.text;
      }
      if ('status' in block && typeof block.status === 'string') {
        return block.status;
      }
      return block.kind;
    })
    .filter(Boolean)
    .join('\n') || message.role;
}

async function unsupportedWorkspaceRestore(_payload: WorkspaceRestorePayload): Promise<WorkspaceRestoreData> {
  throw new Error('Workspace restore is not supported by the target Workspace module.');
}

function nextPersistedRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((maxSequence, event) => Math.max(maxSequence, event.sequence), 0) + 1;
}
