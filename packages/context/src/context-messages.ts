/*
 * Converts the Session active path into provider-neutral AI Messages: saved
 * UserMessage.modelContent plus persisted attachments, real Assistant metadata,
 * ToolResult facts and Compaction Summaries, with ToolCall/ToolResult closure.
 */

import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
} from '@megumi/ai';
import type {
  SessionAttachmentReader,
  SessionHistoryItem,
  SessionMessage,
  SessionMessageAttachment,
} from '@megumi/session';
import type { ContextFailure } from './context';
import { encodeBase64, materializeSessionImage } from './image-content';

const COMPACTION_SUMMARY_PREFIX = 'The conversation history before this point was compacted into the following summary:\n\n<summary>\n';
const COMPACTION_SUMMARY_SUFFIX = '\n</summary>';

export type BuildContextMessagesResult =
  | { readonly status: 'ok'; readonly messages: Message[] }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

/** Lightweight history conversion for token estimation without reading image bytes. */
export function sessionMessagesToEstimateMessages(
  history: readonly SessionHistoryItem[],
): Message[] {
  const messages: Message[] = [];
  for (const item of history) {
    if (item.type === 'compaction') {
      messages.push(compactionSummaryMessage(item.compaction.summary_text, item.compaction.created_at));
      continue;
    }
    const message = item.message;
    if (message.message_kind === 'user_message') {
      messages.push({
        role: 'user',
        content: [
          ...message.model_content.filter((block): block is TextContent => block.type === 'text'),
          ...item.attachments.map(estimateAttachmentContent),
        ],
        timestamp: timestampOf(message.created_at),
      });
    } else if (message.message_kind === 'model_response' || message.message_kind === 'assistant_reply') {
      messages.push(assistantMessageFromSession(message, message.created_at));
    } else if (message.message_kind === 'tool_result') {
      messages.push(toolResultMessageFromSession(message, message.created_at));
    }
  }
  return messages;
}

export async function buildContextMessages(input: {
  readonly history: readonly SessionHistoryItem[];
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: boolean;
  readonly signal?: AbortSignal;
}): Promise<BuildContextMessagesResult> {
  const messages: Message[] = [];
  const knownToolCallIds = new Set<string>();
  for (const item of input.history) {
    if (input.signal?.aborted) return { status: 'failed', failure: cancelled() };
    if (item.type === 'compaction') {
      messages.push(compactionSummaryMessage(item.compaction.summary_text, item.compaction.created_at));
      continue;
    }
    const message = item.message;
    if (message.message_kind === 'user_message') {
      const content = await materializeUserMessageContent({
        blocks: message.model_content,
        attachments: item.attachments,
        attachmentReader: input.attachmentReader,
        imageInputSupport: input.imageInputSupport,
        signal: input.signal,
      });
      if (content.status === 'failed') return content;
      messages.push({ role: 'user', content: content.content, timestamp: timestampOf(message.created_at) });
    } else if (message.message_kind === 'model_response' || message.message_kind === 'assistant_reply') {
      const converted = assistantMessageFromSession(message, message.created_at);
      for (const block of converted.content) {
        if (block.type === 'toolCall') knownToolCallIds.add(block.id);
      }
      messages.push(converted);
    } else if (message.message_kind === 'tool_result') {
      if (!knownToolCallIds.has(message.tool_call_id)) {
        return {
          status: 'failed',
          failure: {
            code: 'protocol_closure_failed',
            message: `ToolResult ${message.tool_call_id} has no matching ToolCall in the active history.`,
            retryable: false,
            cause: { owner: 'session' },
          },
        };
      }
      const content = await materializeBlocks(
        message.content,
        input.attachmentReader,
        input.imageInputSupport,
        input.signal,
      );
      if (content.status === 'failed') return content;
      messages.push({
        role: 'toolResult',
        toolCallId: message.tool_call_id,
        toolName: message.tool_name,
        content: content.content,
        ...(message.error ? { details: { error: message.error } } : {}),
        ...(message.usage ? { usage: message.usage } : {}),
        isError: message.status !== 'success',
        timestamp: timestampOf(message.created_at),
      });
    }
  }
  return { status: 'ok', messages };
}

async function materializeUserMessageContent(input: {
  readonly blocks: readonly import('@megumi/ai').ContentBlock[];
  readonly attachments: readonly SessionMessageAttachment[];
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: boolean;
  readonly signal?: AbortSignal;
}): Promise<
  { readonly status: 'ok'; readonly content: Array<TextContent | ImageContent> }
  | { readonly status: 'failed'; readonly failure: ContextFailure }
> {
  const content: Array<TextContent | ImageContent> = [];
  for (const block of input.blocks) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'json') content.push({ type: 'text', text: JSON.stringify(block.value) });
  }
  for (const attachment of [...input.attachments].sort((left, right) => left.ordinal - right.ordinal)) {
    if (input.signal?.aborted) return { status: 'failed', failure: cancelled() };
    if (attachment.type === 'image') {
      const materialized = await materializeSessionImage({
        attachment,
        attachmentReader: input.attachmentReader,
        imageInputSupport: input.imageInputSupport,
        signal: input.signal,
      });
      if (materialized.status === 'failed') return materialized;
      content.push(materialized.content);
    } else {
      const path = attachment.source_type === 'local_file' ? attachment.source_value : undefined;
      if (!path || !attachment.name || !attachment.mime_type || attachment.size_bytes === undefined) {
        return documentAttachmentFailure(
          `Document attachment ${attachment.attachment_id} is missing persisted metadata.`,
        );
      }
      content.push({
        type: 'text',
        text: attachedDocumentBlock({
          name: attachment.name,
          mediaType: attachment.mime_type,
          path,
          sizeBytes: attachment.size_bytes,
        }),
      });
    }
  }
  return { status: 'ok', content };
}

async function materializeBlocks(
  blocks: readonly import('@megumi/ai').ContentBlock[],
  attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>,
  imageInputSupport: boolean,
  signal?: AbortSignal,
): Promise<
  { readonly status: 'ok'; readonly content: Array<TextContent | ImageContent> }
  | { readonly status: 'failed'; readonly failure: ContextFailure }
> {
  const content: Array<TextContent | ImageContent> = [];
  for (const block of blocks) {
    if (signal?.aborted) return { status: 'failed', failure: cancelled() };
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'json') content.push({ type: 'text', text: JSON.stringify(block.value) });
    else if (block.type === 'image' && block.source.type === 'host_reference') {
      if (!imageInputSupport) {
        content.push({
          type: 'text',
          text: '[An image was attached, but the selected model cannot view image content.]',
        });
        continue;
      }
      const read = await attachmentReader.readAttachmentContent({
        attachment_id: block.source.referenceId,
      });
      if (read.status === 'failed') {
        return {
          status: 'failed',
          failure: {
            code: 'image_materialization_failed',
            message: read.failure.message,
            retryable: false,
            cause: { owner: 'session', code: read.failure.code },
          },
        };
      }
      content.push({
        type: 'image',
        data: encodeBase64(read.content.bytes),
        mimeType: read.content.media_type,
      });
    }
  }
  return { status: 'ok', content };
}

function assistantMessageFromSession(
  message: SessionMessage,
  createdAt: string,
): AssistantMessage {
  if (message.message_kind !== 'model_response' && message.message_kind !== 'assistant_reply') {
    throw new Error('Unreachable Session message kind.');
  }
  const content = message.content.map((block) => {
    if (block.type === 'text') return { type: 'text' as const, text: block.text };
    if (block.type === 'thinking') return { type: 'thinking' as const, thinking: block.thinking };
    return {
      type: 'toolCall' as const,
      id: block.id,
      name: block.name,
      arguments: parseJson(block.argumentsText),
    };
  });
  // 'unknown' is inert: it never matches the current Model and never forms a
  // valid Usage baseline. We never fabricate a real provider identity.
  const base = {
    role: 'assistant' as const,
    content,
    api: message.api ?? 'unknown',
    provider: message.provider ?? 'unknown',
    model: message.model ?? 'unknown',
    ...(message.response_model ? { responseModel: message.response_model } : {}),
    ...(message.response_id ? { responseId: message.response_id } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.error_message ? { errorMessage: message.error_message } : {}),
    timestamp: timestampOf(createdAt),
  };
  if (message.message_kind === 'model_response') {
    return {
      ...base,
      ...(message.failure ? { failure: message.failure as AssistantMessage['failure'] } : {}),
      stopReason: (message.stop_reason as AssistantMessage['stopReason']) ?? 'stop',
    };
  }
  return { ...base, stopReason: 'stop' };
}

function toolResultMessageFromSession(
  message: Extract<SessionMessage, { message_kind: 'tool_result' }>,
  createdAt: string,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: message.tool_call_id,
    toolName: message.tool_name,
    content: message.content.flatMap((block) => {
      if (block.type === 'text') return [{ type: 'text' as const, text: block.text }];
      if (block.type === 'json') return [{ type: 'text' as const, text: JSON.stringify(block.value) }];
      if (block.type === 'file') {
        return [{
          type: 'text' as const,
          text: `[File attachment: ${block.name ?? block.path} at ${block.path}]`,
        }];
      }
      return [];
    }),
    ...(message.error ? { details: { error: message.error } } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    isError: message.status !== 'success',
    timestamp: timestampOf(createdAt),
  };
}

export function buildCompactionSummaryMessage(summary: string, timestamp: number): Message {
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: `${COMPACTION_SUMMARY_PREFIX}${summary}${COMPACTION_SUMMARY_SUFFIX}`,
    }],
    timestamp,
  };
}

function compactionSummaryMessage(summary: string, createdAt: string): Message {
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: `${COMPACTION_SUMMARY_PREFIX}${summary}${COMPACTION_SUMMARY_SUFFIX}`,
    }],
    timestamp: timestampOf(createdAt),
  };
}

function attachedDocumentBlock(input: {
  name: string;
  mediaType: string;
  path: string;
  sizeBytes: number;
}): string {
  return [
    `<attached_document`,
    `  name="${escapeXmlAttribute(input.name)}"`,
    `  media_type="${escapeXmlAttribute(input.mediaType)}"`,
    `  path="${escapeXmlAttribute(input.path)}"`,
    `  size_bytes="${input.sizeBytes}">`,
    'This document was attached by the user. Use the available file tools to read it when needed.',
    '</attached_document>',
  ].join('\n');
}

function estimateAttachmentContent(attachment: SessionMessageAttachment): TextContent | ImageContent {
  if (attachment.type === 'image') {
    return { type: 'image', data: '', mimeType: attachment.mime_type ?? 'image/png' };
  }
  const path = attachment.source_value;
  return {
    type: 'text',
    text: attachedDocumentBlock({
      name: attachment.name ?? attachment.attachment_id,
      mediaType: attachment.mime_type ?? 'application/octet-stream',
      path,
      sizeBytes: attachment.size_bytes ?? 0,
    }),
  };
}

function documentAttachmentFailure(message: string): { status: 'failed'; failure: ContextFailure } {
  return {
    status: 'failed',
    failure: {
      code: 'document_attachment_failed',
      message,
      retryable: false,
      cause: { owner: 'session' },
    },
  };
}

function timestampOf(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { value };
  }
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cancelled(): ContextFailure {
  return {
    code: 'cancelled',
    message: 'Context construction was cancelled.',
    retryable: true,
  };
}
