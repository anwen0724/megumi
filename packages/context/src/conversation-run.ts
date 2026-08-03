/* Converts Session history and live Run facts into continuous model-facing conversation Runs. */
import type {
  AssistantContentBlock,
  AssistantMessage,
  ContentBlock,
  JsonObject,
  JsonValue,
} from '@megumi/ai';
import type {
  SessionHistoryItem,
  SessionMessageAttachment,
} from '@megumi/session';

export type ConversationItem =
  | { readonly type: 'user_message'; readonly content: ContentBlock[] }
  | {
      readonly type: 'assistant_message';
      readonly content: AssistantContentBlock[];
      readonly modelMessage?: AssistantMessage;
    }
  | {
      readonly type: 'tool_call';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: JsonValue;
      readonly thoughtSignature?: string;
    }
  | {
      readonly type: 'tool_result';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: 'success' | 'failure' | 'cancelled';
      readonly content: ContentBlock[];
      readonly error?: { readonly code: string; readonly message: string };
    }
  | {
      readonly type: 'context';
      readonly kind: 'model_retry_instruction';
      readonly content: JsonValue;
    };

type UserMessage = Extract<ConversationItem, { type: 'user_message' }>;
type ResponseItem = Exclude<ConversationItem, UserMessage>;

export interface ConversationRun {
  readonly source: {
    readonly runId: string;
    readonly userEntryId: string;
    readonly userMessageId: string;
    readonly lastEntryId: string;
    readonly responseMessageRefs: Array<{ readonly entryId: string; readonly messageId: string }>;
  };
  readonly userMessage: UserMessage;
  readonly items: ResponseItem[];
}

export interface CurrentConversationRun {
  readonly runId: string;
  readonly lastEntryId?: string;
  readonly userEntry: {
    readonly entryId: string;
    readonly parentEntryId?: string;
  };
  readonly userMessage: UserMessage;
  readonly runItems: ResponseItem[];
}

type MessageHistoryItem = Extract<SessionHistoryItem, { type: 'message' }>;

export function buildConversationRuns(history: SessionHistoryItem[]): ConversationRun[] {
  const messages = historyAfterEffectiveCompaction(history)
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
        content: [...user.message.model_content, ...user.attachments.map(attachmentContent)],
      },
      items: responseItems(responses),
    });
  }
  return runs;
}

export function conversationItemsFromRun(run: ConversationRun): ConversationItem[] {
  return [run.userMessage, ...run.items];
}

function responseItems(messages: MessageHistoryItem[]): ConversationRun['items'] {
  const items: ConversationRun['items'] = [];
  const callIds = new Set(messages.flatMap(({ message }) => (
    message.message_kind === 'model_response'
      ? message.content.flatMap((block) => block.type === 'toolCall' ? [block.id] : [])
      : []
  )));
  for (const { message } of messages) {
    if (message.message_kind === 'model_response') {
      appendAssistantContent(items, message.content);
      const calls = message.content.filter(
        (block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall',
      );
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
          status: message.status === 'success'
            ? 'success'
            : message.status === 'cancelled' ? 'cancelled' : 'failure',
          content: message.content,
        });
      }
      continue;
    }
    if (message.message_kind === 'assistant_reply') appendAssistantContent(items, message.content);
  }
  return repairInterruptedToolCalls(items);
}

function repairInterruptedToolCalls(items: ConversationRun['items']): ConversationRun['items'] {
  const completedCallIds = new Set(items.flatMap((item) => (
    item.type === 'tool_result' ? [item.toolCallId] : []
  )));
  const repaired: ConversationRun['items'] = [];
  const missingGroup: Extract<ConversationRun['items'][number], { type: 'tool_call' }>[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    repaired.push(item);
    if (item.type === 'tool_call' && !completedCallIds.has(item.toolCallId)) missingGroup.push(item);
    if (item.type === 'tool_call' && items[index + 1]?.type === 'tool_call') continue;
    for (const missing of missingGroup.splice(0)) {
      repaired.push({
        type: 'tool_result',
        toolCallId: missing.toolCallId,
        toolName: missing.toolName,
        status: 'cancelled',
        error: {
          code: 'runtime_interrupted',
          message: 'Tool execution was interrupted before a result was committed.',
        },
        content: [{
          type: 'text',
          text: 'Tool execution was cancelled because the previous runtime was interrupted.',
        }],
      });
    }
  }
  return repaired;
}

function appendAssistantContent(
  items: ConversationRun['items'],
  content: AssistantContentBlock[],
): void {
  const semanticContent: AssistantContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) semanticContent.push({ type: 'text', text: block.text });
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
    if (history[index]!.type === 'compaction') return history.slice(index + 1);
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
