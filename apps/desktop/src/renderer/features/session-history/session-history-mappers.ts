import type { RunDto, SessionDto } from '@megumi/product/host';
import type { AnyEvent } from '@megumi/product/host';
import type { AnswerTextBlock, TimelineMessage } from '@megumi/product/host';

export interface TimelineHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function isCompletedAnswerTextBlock(block: TimelineMessage['blocks'][number]): block is AnswerTextBlock {
  return block.kind === 'answer_text' && block.status === 'completed';
}

export function localSessionFromPersistedSession(session: SessionDto): SessionDto {
  return session;
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
  runs: Array<Pick<RunDto, 'runId'>>,
  eventsByRun: Record<string, AnyEvent[]>,
): AnyEvent[] {
  const runIds = new Set(runs.map((run) => run.runId));
  return Object.entries(eventsByRun)
    .filter(([runId]) => runIds.has(runId))
    .flatMap(([, events]) => events)
    .filter((event) => event.type !== 'message.update')
    .sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      return createdAtOrder === 0 ? left.sequence - right.sequence : createdAtOrder;
    });
}
