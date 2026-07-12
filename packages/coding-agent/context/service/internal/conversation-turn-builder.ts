/*
 * Combines Session messages with Agent Run historical facts without requiring optional fields.
 */
import type { ContentBlock } from '@megumi/ai';
import type { HistoricalRun } from '../../../agent-run';
import { sessionConversationText, type SessionHistoryItem, type SessionMessageAttachment } from '../../../session';
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export type BuildConversationTurnsRequest = {
  history: SessionHistoryItem[];
  historicalRunsByRunId: ReadonlyMap<string, HistoricalRun>;
};

export type BuildConversationTurnsResult = { status: 'built'; turns: ConversationTurn[] };
type MessageHistoryItem = Extract<SessionHistoryItem, { type: 'message' }>;

export function buildConversationTurns(request: BuildConversationTurnsRequest): BuildConversationTurnsResult {
  const messages = historyAfterEffectiveCompaction(request.history).filter(
    (item): item is MessageHistoryItem => item.type === 'message',
  );
  const turns: ConversationTurn[] = [];

  for (let index = 0; index < messages.length;) {
    const user = messages[index]!;
    if (user.message.conversation.role !== 'user' || !user.message.run_id) {
      index += 1;
      continue;
    }
    const runId = user.message.run_id;
    const historicalRun = request.historicalRunsByRunId.get(runId);
    const possibleAssistant = messages[index + 1];
    const assistant = possibleAssistant?.message.conversation.role === 'assistant' && possibleAssistant.message.run_id === runId
      ? possibleAssistant
      : undefined;

    turns.push({
      source: {
        runId,
        userEntryId: user.entry.entry_id,
        userMessageId: user.message.message_id,
        ...(assistant ? {
          assistantEntryId: assistant.entry.entry_id,
          assistantMessageId: assistant.message.message_id,
        } : {}),
      },
      ...(historicalRun ? { runStatus: historicalRun.runStatus } : {}),
      userMessage: { type: 'user_message', content: messageContent(user.message.conversation.content, user.attachments) },
      modelSteps: historicalRun?.modelSteps ?? [],
      ...(assistant ? {
        finalAssistantMessage: {
          type: 'assistant_message',
          content: assistant.message.conversation.role === 'assistant'
            ? assistant.message.conversation.content.filter((block) => block.type === 'text')
            : [{ type: 'text', text: sessionConversationText(assistant.message.conversation) }],
        },
      } : {}),
      ...(historicalRun?.finalOutcome ? { finalOutcome: historicalRun.finalOutcome } : {}),
      diagnostics: historicalRun?.diagnostics ?? [{
        code: 'historical_run_not_found',
        message: `No Agent Run history was found for ${runId}.`,
      }],
    });
    index += assistant ? 2 : 1;
  }
  return { status: 'built', turns };
}

function messageContent(content: ContentBlock[], attachments: SessionMessageAttachment[]): ContentBlock[] {
  return [...content, ...attachments.map(attachmentContent)];
}

function historyAfterEffectiveCompaction(history: SessionHistoryItem[]): SessionHistoryItem[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].type === 'compaction') return history.slice(index + 1);
  }
  return history;
}

function attachmentContent(attachment: SessionMessageAttachment): ContentBlock {
  if (attachment.type === 'image') {
    return {
      type: 'image',
      source: attachment.source_type === 'local_file'
        ? { type: 'local_file', path: attachment.source_value }
        : { type: 'host_reference', referenceId: attachment.source_value },
    };
  }
  return {
    type: 'file',
    fileId: attachment.attachment_id,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
  };
}
