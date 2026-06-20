// Coordinates live AgentRuntimeEvent commits into renderer timeline history storage for the desktop host.
import type { AgentRuntimeEvent } from '../../app';
import type { SqliteTimelineMessageRepository } from '../../database';
import { createAgentRuntimeChatStreamAdapter } from '../renderer-protocol/chat-stream/agent-runtime-chat-stream-adapter';
import {
  TimelineHistoryCommitProjector,
  type TimelineHistoryCommitPayload,
  type TimelineHistoryDiagnosticIntent,
  type TimelineHistoryProjectionResult,
} from '../renderer-protocol/timeline/timeline-history-projection';

export interface TimelineHistoryCommitService {
  handle(event: AgentRuntimeEvent): void;
  dispose(): void;
}

export function createTimelineHistoryCommitService(options: {
  repository: SqliteTimelineMessageRepository;
  createDiagnosticId: () => string;
}): TimelineHistoryCommitService {
  const projector = new TimelineHistoryCommitProjector();
  const adapter = createAgentRuntimeChatStreamAdapter({
    publish(event) {
      const result = projector.publish(event);
      if (result) handleProjectionResult(result);
    },
  });

  return {
    handle(event) {
      adapter.handle(event);
    },
    dispose() {
      adapter.dispose();
    },
  };

  function handleProjectionResult(result: TimelineHistoryProjectionResult): void {
    if (result.kind === 'diagnostic') {
      recordDiagnostic(result.diagnostic);
      return;
    }
    commitTimeline(result.payload);
  }

  function commitTimeline(payload: TimelineHistoryCommitPayload): void {
    try {
      options.repository.commitRunTimeline(payload);
    } catch {
      recordDiagnostic(projector.createDiagnosticIntent(payload));
    }
  }

  function recordDiagnostic(intent: TimelineHistoryDiagnosticIntent): void {
    options.repository.recordCommitDiagnostic({
      diagnosticId: options.createDiagnosticId(),
      projectId: intent.projectId,
      sessionId: intent.sessionId,
      runId: intent.runId,
      code: intent.code,
      message: intent.message,
      createdAt: intent.createdAt,
    });
  }
}
