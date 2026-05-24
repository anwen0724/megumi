import type { ChatMessage } from '@megumi/shared/chat-contracts';
import type { Run, Session, SessionMessage } from '@megumi/shared/session-run-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { AnswerTextBlock, TimelineMessage } from '@megumi/shared/timeline-message-blocks';
import type { TimelineMessageData, TimelineMessageRole } from '../../entities/chat/types';
import type { LocalRendererSession } from '../../entities/session/session-factory';

function sessionProjectId(session: Session): string {
  return session.workspaceId ?? session.workspacePath ?? 'local';
}

function timelineRole(role: SessionMessage['role']): TimelineMessageRole {
  if (role === 'host') {
    return 'system';
  }
  return role;
}

function isCompletedAnswerTextBlock(block: TimelineMessage['blocks'][number]): block is AnswerTextBlock {
  return block.kind === 'answer_text' && block.status === 'completed';
}

export function localSessionFromPersistedSession(session: Session): LocalRendererSession {
  return {
    id: session.sessionId,
    projectId: sessionProjectId(session),
    agentType: 'free',
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function timelineMessagesFromPersistedMessages(messages: SessionMessage[]): TimelineMessageData[] {
  return messages.map((message, index) => ({
    id: message.messageId,
    role: timelineRole(message.role),
    content: message.content,
    timestamp: message.createdAt,
    stepNum: index + 1,
  }));
}

export function chatMessagesFromTimelineMessages(messages: TimelineMessage[]): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    if (message.role === 'user') {
      const text = message.blocks
        .filter((block) => block.kind === 'user_text')
        .map((block) => block.text)
        .join('\n');

      return text ? [{
        id: String(message.messageId),
        role: 'user',
        content: text,
        createdAt: message.createdAt,
      }] : [];
    }

    const answer = message.blocks.find(isCompletedAnswerTextBlock);
    return answer?.text ? [{
      id: String(message.messageId),
      role: 'assistant',
      content: answer.text,
      createdAt: message.createdAt,
    }] : [];
  });
}

export function hydratedRuntimeEventsForRuns(
  runs: Run[],
  eventsByRun: Record<string, RuntimeEvent[]>,
): RuntimeEvent[] {
  const runIds = new Set(runs.map((run) => run.runId));
  return Object.entries(eventsByRun)
    .filter(([runId]) => runIds.has(runId))
    .flatMap(([, events]) => events)
    .filter((event) => event.eventType !== 'assistant.output.delta' && event.eventType !== 'model.output.delta')
    .sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      return createdAtOrder === 0 ? left.sequence - right.sequence : createdAtOrder;
    });
}
