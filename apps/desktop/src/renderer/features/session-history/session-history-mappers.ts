import type { ChatRunUiDto, ChatSessionUiDto } from '@megumi/product/host-interface';
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import type { AnswerTextBlock, TimelineMessage } from '@megumi/product/runtime-timeline';

export interface TimelineHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function isCompletedAnswerTextBlock(block: TimelineMessage['blocks'][number]): block is AnswerTextBlock {
  return block.kind === 'answer_text' && block.status === 'completed';
}

export function localSessionFromPersistedSession(session: ChatSessionUiDto): ChatSessionUiDto {
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
  runs: Array<Pick<ChatRunUiDto, 'runId'>>,
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
