/*
 * Builds provider-neutral historical Runs from explicit Session message
 * variants. Only live-run lookup is process-local; all other facts come from
 * the active Session Entry path.
 */
import type { AssistantContentBlock, ContentBlock } from '../../../model-content';
import type { JsonValue } from '../../../shared-json';
import {
  type SessionHistoryItem,
  type SessionMessageAttachment,
} from '../../../session';
import type { ConversationRun } from '../../domain/model/conversation-run';

export type BuildConversationRunsRequest = {
  history: SessionHistoryItem[];
};
export type BuildConversationRunsResult = { status: 'built'; runs: ConversationRun[] };
type MessageHistoryItem = Extract<SessionHistoryItem, { type: 'message' }>;

export function buildConversationRuns(request: BuildConversationRunsRequest): BuildConversationRunsResult {
  const messages = historyAfterEffectiveCompaction(request.history)
    .filter((item): item is MessageHistoryItem => item.type === 'message');
  const runs: ConversationRun[] = [];

  for (let index = 0; index < messages.length;) {
    const user = messages[index]!;
    if (user.message.message_kind !== 'user_message' || !user.message.run_id) {
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
    runs.push({
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
        content: [...user.message.content, ...user.attachments.map(attachmentContent)],
      },
      items: responseItems(responses),
    });
  }
  return { status: 'built', runs };
}

function responseItems(messages: MessageHistoryItem[]): ConversationRun['items'] {
  const items: ConversationRun['items'] = [];
  const callIds = new Set(messages.flatMap(({ message }) =>
    message.message_kind === 'model_response'
      ? message.content.flatMap((block) => block.type === 'toolCall' ? [block.id] : [])
      : []));
  for (const { message } of messages) {
    if (message.message_kind === 'model_response') {
      appendAssistantContent(items, message.content);
      const calls = message.content.filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall');
      items.push(...calls.map((call) => ({
        type: 'tool_call' as const,
        toolCallId: call.id,
        toolName: call.name,
        arguments: parseArguments(call.argumentsText),
      })));
      continue;
    }
    if (message.message_kind === 'tool_result') {
      if (callIds.has(message.tool_call_id)) {
        items.push({
          type: 'tool_result',
          toolCallId: message.tool_call_id,
          toolName: message.tool_name,
          status: message.status === 'success' ? 'success' : 'failure',
          content: message.content,
        });
      }
      continue;
    }
    if (message.message_kind === 'assistant_reply') {
      appendAssistantContent(items, message.content);
    }
  }
  return items;
}

function appendAssistantContent(
  items: ConversationRun['items'],
  content: AssistantContentBlock[],
): void {
  const semanticContent: AssistantContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      semanticContent.push({ type: 'text', text: block.text });
    }
    if (block.type === 'thinking' && block.thinking) {
      semanticContent.push({ type: 'thinking', thinking: block.thinking });
    }
  }
  if (semanticContent.length > 0) items.push({ type: 'assistant_message', content: semanticContent });
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
      source: { type: 'host_reference', referenceId: attachment.attachment_id },
    };
  }
  return {
    type: 'file',
    path: attachment.source_value,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
  };
}
