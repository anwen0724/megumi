/*
 * Builds provider-neutral historical Runs from explicit Session message
 * variants. Only live-run lookup is process-local; all other facts come from
 * the active Session Entry path.
 */
import type { ContentBlock, JsonValue } from '@megumi/ai';
import {
  isLegacySessionMessage,
  type SessionHistoryItem,
  type SessionMessageAttachment,
} from '../../../session';
import type { ConversationRun } from '../../domain/model/conversation-run';

export type BuildConversationRunsRequest = {
  history: SessionHistoryItem[];
  isRunLive?: (runId: string) => boolean;
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
      items: responseItems(runId, user, responses, request.isRunLive),
    });
  }
  return { status: 'built', runs };
}

function responseItems(
  runId: string,
  user: MessageHistoryItem,
  messages: MessageHistoryItem[],
  isRunLive?: (runId: string) => boolean,
): ConversationRun['items'] {
  const items: ConversationRun['items'] = [];
  const resultIds = new Set(messages.flatMap(({ message }) =>
    message.message_kind === 'tool_result' ? [message.tool_call_id] : []));
  const callIds = new Set(messages.flatMap(({ message }) =>
    message.message_kind === 'model_response'
      ? message.content.flatMap((block) => block.type === 'toolCall' ? [block.id] : [])
      : []));
  let hasReply = false;
  let hasLegacyFact = isLegacySessionMessage(user.message);

  for (const { message } of messages) {
    hasLegacyFact ||= isLegacySessionMessage(message);
    if (message.message_kind === 'model_response') {
      appendAssistantText(items, message.content);
      const calls = message.content.filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall');
      const completedCalls = calls.filter((call) => resultIds.has(call.id));
      items.push(...completedCalls.map((call) => ({
        type: 'tool_call' as const,
        toolCallId: call.id,
        toolName: call.name,
        arguments: parseArguments(call.argumentsText),
      })));
      const pendingCalls = calls.filter((call) => !resultIds.has(call.id));
      if (pendingCalls.length > 0 || message.outcome_status !== 'completed') {
        items.push(runState({
          status: message.outcome_status,
          reasonCode: message.reason_code,
          stopReason: message.stop_reason,
          pendingWorkToolCalls: pendingCalls.map((call) => ({ id: call.id, name: call.name })),
        }));
      }
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
      } else {
        items.push(runState({
          status: 'incomplete',
          reasonCode: 'orphaned_tool_result',
          toolCallId: message.tool_call_id,
          toolName: message.tool_name,
        }));
      }
      continue;
    }
    if (message.message_kind === 'assistant_reply') {
      hasReply = true;
      appendAssistantText(items, message.content);
      if (message.status !== 'completed') {
        items.push(runState({
          status: message.status,
          reasonCode: message.reason_code,
          partial: hasVisibleText(message.content),
        }));
      }
    }
  }

  if (!hasReply && !isRunLive?.(runId)) {
    items.push(runState({ status: hasLegacyFact ? 'legacy_unknown' : 'interrupted' }));
  }
  return items;
}

function appendAssistantText(
  items: ConversationRun['items'],
  content: Array<{ type: string; text?: string }>,
): void {
  const visible = content.flatMap((block) =>
    block.type === 'text' && block.text ? [{ type: 'text' as const, text: block.text }] : []);
  if (visible.length > 0) items.push({ type: 'assistant_message', content: visible });
}

function hasVisibleText(content: Array<{ type: string; text?: string }>): boolean {
  return content.some((block) => block.type === 'text' && Boolean(block.text?.trim()));
}

function runState(content: Record<string, JsonValue | undefined>): ConversationRun['items'][number] {
  return {
    type: 'context',
    kind: 'historical_run_state',
    content: Object.fromEntries(Object.entries(content).filter(([, value]) => value !== undefined)) as JsonValue,
  };
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
    fileId: attachment.attachment_id,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
  };
}
