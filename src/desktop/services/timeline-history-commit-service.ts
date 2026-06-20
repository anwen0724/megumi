// Coordinates live AgentRuntimeEvent commits into renderer timeline history storage for the desktop host.
import type { AgentRuntimeEvent } from '../../app';
import type { SqliteTimelineMessageRepository } from '../../database';
import { createAgentRuntimeChatStreamAdapter } from '../renderer-protocol/chat-stream/agent-runtime-chat-stream-adapter';
import { TimelineHistoryCommitProjector } from '../renderer-protocol/timeline/timeline-history-projection';

export interface TimelineHistoryCommitService {
  handle(event: AgentRuntimeEvent): void;
  dispose(): void;
}

export function createTimelineHistoryCommitService(options: {
  repository: SqliteTimelineMessageRepository;
  createDiagnosticId: () => string;
}): TimelineHistoryCommitService {
  const projector = new TimelineHistoryCommitProjector({
    repository: options.repository,
    createDiagnosticId: options.createDiagnosticId,
  });
  const adapter = createAgentRuntimeChatStreamAdapter(projector);

  return {
    handle(event) {
      adapter.handle(event);
    },
    dispose() {
      adapter.dispose();
    },
  };
}
