import type { Run, Session } from '@megumi/renderer-contracts/session';
import type { RuntimeEvent } from '@megumi/renderer-contracts/runtime';
import type { AnswerTextBlock, TimelineMessage } from '@megumi/renderer-contracts/timeline';
import type { LocalRendererSession } from '../../entities/session/session-factory';

export interface TimelineHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function sessionProjectId(session: Session): string {
  return session.workspaceId ?? session.workspacePath ?? 'local';
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

export function chatMessagesFromTimelineMessages(messages: TimelineMessage[]): TimelineHistoryMessage[] {
  return messages.flatMap((message): TimelineHistoryMessage[] => {
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

