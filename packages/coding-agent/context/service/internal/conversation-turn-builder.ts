/*
 * Builds historical Turns directly from Session-owned semantic messages on
 * the active Entry path. It never reads or infers persisted Run state.
 */
import type { ContentBlock, ConversationItem, JsonValue } from '@megumi/ai';
import type { SessionHistoryItem, SessionMessageAttachment } from '../../../session';
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export type BuildConversationTurnsRequest = { history: SessionHistoryItem[] };
export type BuildConversationTurnsResult = { status: 'built'; turns: ConversationTurn[] };
type MessageHistoryItem = Extract<SessionHistoryItem, { type: 'message' }>;

export function buildConversationTurns(request: BuildConversationTurnsRequest): BuildConversationTurnsResult {
  const messages = historyAfterEffectiveCompaction(request.history)
    .filter((item): item is MessageHistoryItem => item.type === 'message');
  const turns: ConversationTurn[] = [];

  for (let index = 0; index < messages.length;) {
    const user = messages[index]!;
    if (user.message.conversation.role !== 'user' || !user.message.run_id) {
      index += 1;
      continue;
    }
    const runId = user.message.run_id;
    const responses: MessageHistoryItem[] = [];
    index += 1;
    while (index < messages.length && messages[index]!.message.run_id === runId) {
      responses.push(messages[index]!);
      index += 1;
    }
    turns.push({
      source: {
        runId,
        userEntryId: user.entry.entry_id,
        userMessageId: user.message.message_id,
        lastEntryId: responses.at(-1)?.entry.entry_id ?? user.entry.entry_id,
        responseMessageRefs: responses.map((item) => ({
          entryId: item.entry.entry_id,
          messageId: item.message.message_id,
        })),
      },
      userMessage: {
        type: 'user_message',
        content: [...user.message.conversation.content, ...user.attachments.map(attachmentContent)],
      },
      items: responseItems(runId, responses),
    });
  }
  return { status: 'built', turns };
}

function responseItems(runId: string, messages: MessageHistoryItem[]): ConversationTurn['items'] {
  const items: ConversationTurn['items'] = [];
  const resultIds = new Set(messages.flatMap((item) => {
    const message = item.message.conversation;
    return message.role === 'toolResult' ? [message.toolCallId] : [];
  }));
  const nativeCallIds = new Set(messages.flatMap((item) => {
    const message = item.message.conversation;
    if (message.role !== 'assistant') return [];
    const calls = message.content.filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall');
    return calls.length > 0 && calls.every((call) => resultIds.has(call.id)) ? calls.map((call) => call.id) : [];
  }));
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index]!.message.conversation;
    if (current.role === 'toolResult') {
      if (nativeCallIds.has(current.toolCallId)) {
        items.push({
          type: 'tool_result', toolCallId: current.toolCallId, toolName: current.toolName,
          status: current.status, content: current.content,
        });
      } else {
        items.push({
          type: 'assistant_message',
          content: [{ type: 'json', value: { historicalRunId: runId, unmatchedToolResult: current } }],
        });
      }
      continue;
    }
    if (current.role !== 'assistant') continue;
    const visible = current.content.filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text');
    if (visible.length > 0) items.push({ type: 'assistant_message', content: visible });
    const calls = current.content.filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall');
    if (calls.length === 0) continue;
    if (calls.every((call) => nativeCallIds.has(call.id))) {
      items.push(...calls.map((call) => ({
        type: 'tool_call' as const,
        toolCallId: call.id,
        toolName: call.name,
        arguments: parseArguments(call.argumentsText),
      })));
    } else {
      items.push({
        type: 'assistant_message',
        content: [{
          type: 'json',
          value: {
            historicalRunId: runId,
            incompleteToolCalls: calls.map((call) => ({ id: call.id, name: call.name, argumentsText: call.argumentsText })),
          },
        }],
      });
    }
  }
  return items;
}

function parseArguments(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
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
    type: 'file', fileId: attachment.attachment_id,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
  };
}
