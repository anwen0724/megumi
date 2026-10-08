/* Builds Coding model messages from committed conversation facts. */
import {
  buildSystemPrompt,
  calculatePromptUsage,
  createNodeInstructionSource,
  loadInstructionFiles,
  loadSystemInstructionDocuments,
} from '@megumi/agent';
import type { AgentConfig, AgentContext, ExecutionEnvironment } from '@megumi/agent';
import { escapeXmlAttribute } from '@megumi/agent/context/prompt-builder';
import type {
  AssistantMessage,
  ImageContent,
  Message,
  Models,
  TextContent,
  ToolResultMessage,
} from '@megumi/ai';
import type { EventBus } from './events/event-bus';
import type { Observability } from '../observability/index';
import type { Skills } from '../skills/manage-skills';
import { compactCodingHistory } from './compact-history';
import { materializeSessionImage, UNSUPPORTED_IMAGE_TEXT } from './input/image-content';
import type {
  SessionAttachmentReader,
  SessionMessageAttachment,
} from './sessions/session-attachments';
import type { SessionHistoryItem } from './sessions/session-branches';
import type {
  RecommendationReferenceContent,
  SessionMessage,
  SessionHistory,
  SessionUserContent,
} from './sessions/session-history';

export interface ContextFailure {
  readonly code:
    | 'cancelled'
    | 'protocol_closure_failed'
    | 'document_attachment_failed'
    | 'image_materialization_failed';
  readonly message: string;
  readonly sourceCode?: string;
}

export const COMPACTION_SUMMARY_PREFIX =
  'The conversation history before this point was compacted into the following summary:\n\n<summary>\n';

const COMPACTION_SUMMARY_SUFFIX = '\n</summary>';

/** One Session Entry identity paired with the AI Message materialized from it. */
export interface CompactionMessageSource {
  readonly entryId: string;
  readonly message: Message;
}

/** The history facts Prompt building and compaction share from one materialization. */
export interface MaterializedHistory {
  readonly messages: readonly Message[];
  readonly compactableSources: readonly CompactionMessageSource[];
  readonly previousSummary?: string;
  readonly expectedActiveEntryId: string;
}

export type BuildContextMessagesResult =
  | { readonly status: 'ok'; readonly materialized: MaterializedHistory }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

/** Lightweight history conversion for token estimation without reading image bytes. */
export function sessionMessagesToEstimateMessages(
  history: readonly SessionHistoryItem[],
): Message[] {
  const messages: Message[] = [];
  for (const item of history) {
    if (item.type === 'compaction') {
      messages.push(
        buildCompactionSummaryMessage(
          item.compaction.summary_text,
          timestampOf(item.compaction.created_at),
        ),
      );
      continue;
    }
    const message = item.message;
    if (message.message_kind === 'user_message') {
      messages.push({
        role: 'user',
        content: [
          ...message.model_content.flatMap((block): TextContent[] => {
            if (block.type === 'text') return [block];
            if (block.type === 'recommendation_reference') {
              return [materializeRecommendationReference(block)];
            }
            return [];
          }),
          ...item.attachments.map(estimateAttachmentContent),
        ],
        timestamp: timestampOf(message.created_at),
      });
    } else if (
      message.message_kind === 'model_response' ||
      message.message_kind === 'assistant_reply'
    ) {
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
  const sources: CompactionMessageSource[] = [];
  let previousSummary: string | undefined;
  const knownToolCallIds = new Set<string>();
  for (const item of input.history) {
    if (input.signal?.aborted) {
      return {
        status: 'failed',
        failure: { code: 'cancelled', message: 'Context construction was cancelled.' },
      };
    }
    if (item.type === 'compaction') {
      // The Summary is a Session fact inside messages but never a compactable
      // source: planning operates on ordinary conversation entries only.
      previousSummary = item.compaction.summary_text;
      messages.push(
        buildCompactionSummaryMessage(
          item.compaction.summary_text,
          timestampOf(item.compaction.created_at),
        ),
      );
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
      messages.push({
        role: 'user',
        content: content.content,
        timestamp: timestampOf(message.created_at),
      });
    } else if (
      message.message_kind === 'model_response' ||
      message.message_kind === 'assistant_reply'
    ) {
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
          },
        };
      }
      const content = await materializeBlocks(
        message.content,
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
    sources.push({ entryId: item.entry.entry_id, message: messages[messages.length - 1]! });
  }
  return {
    status: 'ok',
    materialized: {
      messages,
      compactableSources: sources,
      ...(previousSummary ? { previousSummary } : {}),
      expectedActiveEntryId: input.history.at(-1)?.entry.entry_id ?? '',
    },
  };
}

async function materializeUserMessageContent(input: {
  readonly blocks: readonly SessionUserContent[];
  readonly attachments: readonly SessionMessageAttachment[];
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: boolean;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: 'ok'; readonly content: Array<TextContent | ImageContent> }
  | { readonly status: 'failed'; readonly failure: ContextFailure }
> {
  const content: Array<TextContent | ImageContent> = [];
  for (const block of input.blocks) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'recommendation_reference')
      content.push(materializeRecommendationReference(block));
    else content.push({ type: 'image', data: block.data, mimeType: block.mimeType });
  }
  for (const attachment of [...input.attachments].sort(
    (left, right) => left.ordinal - right.ordinal,
  )) {
    if (input.signal?.aborted) {
      return {
        status: 'failed',
        failure: { code: 'cancelled', message: 'Context construction was cancelled.' },
      };
    }
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
      if (
        !path ||
        !attachment.name ||
        !attachment.mime_type ||
        attachment.size_bytes === undefined
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'document_attachment_failed',
            message: `Document attachment ${attachment.attachment_id} is missing persisted metadata.`,
          },
        };
      }
      content.push({
        type: 'text',
        text: buildAttachedDocumentBlock({
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
  blocks: readonly SessionUserContent[],
  imageInputSupport: boolean,
  signal?: AbortSignal,
): Promise<
  | { readonly status: 'ok'; readonly content: Array<TextContent | ImageContent> }
  | { readonly status: 'failed'; readonly failure: ContextFailure }
> {
  const content: Array<TextContent | ImageContent> = [];
  for (const block of blocks) {
    if (signal?.aborted) {
      return {
        status: 'failed',
        failure: { code: 'cancelled', message: 'Context construction was cancelled.' },
      };
    }
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'recommendation_reference')
      content.push(materializeRecommendationReference(block));
    else if (imageInputSupport)
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType });
    else content.push({ type: 'text', text: UNSUPPORTED_IMAGE_TEXT });
  }
  return { status: 'ok', content };
}

function assistantMessageFromSession(message: SessionMessage, createdAt: string): AssistantMessage {
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
      arguments: block.arguments,
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
    usage: message.usage ?? ZERO_USAGE,
    ...(message.error_message ? { errorMessage: message.error_message } : {}),
    timestamp: timestampOf(createdAt),
  };
  if (message.message_kind === 'model_response') {
    return {
      ...base,
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
    content: message.content.map((block) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text };
      if (block.type === 'recommendation_reference')
        return materializeRecommendationReference(block);
      return { type: 'image' as const, data: block.data, mimeType: block.mimeType };
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
    content: [
      {
        type: 'text',
        text: `${COMPACTION_SUMMARY_PREFIX}${summary}${COMPACTION_SUMMARY_SUFFIX}`,
      },
    ],
    timestamp,
  };
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const;

function estimateAttachmentContent(
  attachment: SessionMessageAttachment,
): TextContent | ImageContent {
  if (attachment.type === 'image') {
    return { type: 'image', data: '', mimeType: attachment.mime_type ?? 'image/png' };
  }
  const path = attachment.source_value;
  return {
    type: 'text',
    text: buildAttachedDocumentBlock({
      name: attachment.name ?? attachment.attachment_id,
      mediaType: attachment.mime_type ?? 'application/octet-stream',
      path,
      sizeBytes: attachment.size_bytes ?? 0,
    }),
  };
}

function timestampOf(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildAttachedDocumentBlock(input: {
  readonly name: string;
  readonly mediaType: string;
  readonly path: string;
  readonly sizeBytes: number;
}): string {
  return [
    '<attached_document',
    `  name="${escapeXmlAttribute(input.name)}"`,
    `  media_type="${escapeXmlAttribute(input.mediaType)}"`,
    `  path="${escapeXmlAttribute(input.path)}"`,
    `  size_bytes="${input.sizeBytes}">`,
    'This document was attached by the user. Use the available file tools to read it when needed.',
    '</attached_document>',
  ].join('\n');
}

function escapeMarkup(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Produces the stable model-visible representation used both now and after reload. */
export function materializeRecommendationReference(
  reference: RecommendationReferenceContent,
): TextContent {
  const lines = [
    `<recommended_content id="${escapeMarkup(reference.recommendationId)}" source="${escapeMarkup(reference.sourceName)}" url="${escapeMarkup(reference.canonicalUrl)}">`,
    `<title>${escapeMarkup(reference.title)}</title>`,
    ...(reference.author ? [`<author>${escapeMarkup(reference.author)}</author>`] : []),
    ...(reference.publishedAt
      ? [`<published_at>${escapeMarkup(reference.publishedAt)}</published_at>`]
      : []),
    ...(reference.description
      ? [`<description>${escapeMarkup(reference.description)}</description>`]
      : []),
    `<recommendation_reason>${escapeMarkup(reference.recommendationReason)}</recommendation_reason>`,
    '</recommended_content>',
  ];
  return { type: 'text', text: lines.join('\n') };
}

export interface CodingContextOptions {
  readonly memory?: { readonly task: import('../memory/memory-consumption').TaskMemory; readonly executionId: () => string };
  readonly observability?: Observability;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly config: AgentConfig & {
    readonly environment: ExecutionEnvironment;
  };
  readonly compactionThresholdRatio: number;
  readonly history: SessionHistory;
  readonly attachments: SessionAttachmentReader;
  readonly ai: Pick<Models, 'completeSimple'>;
  readonly megumiHomePath: string;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string }[];
  readonly readInstructionPolicy?: (workspaceId: string) => { fallbackNames: readonly string[]; maxBytes: number };
  readonly skills?: Pick<Skills, 'createView'>;
  readonly events?: Pick<EventBus, 'publish'>;
}

/** Reads complete committed context for each model request. */
export function createCodingContext(options: CodingContextOptions): AgentContext {
  return {
    compact: ({ reason, signal }) => compactCodingHistory({ options, trigger: reason, signal }),
    async prepare({ tools: suppliedTools, signal }) {
      signal.throwIfAborted();
      const history = options.history.getActiveHistory({ session_id: options.sessionId });
      if (history.status === 'failed') throw new Error(history.failure.message);
      const [built, documents, instructions, skills] = await Promise.all([
        buildContextMessages({
          history: history.history,
          attachmentReader: options.attachments,
          imageInputSupport: options.config.model.input.includes('image'),
          signal,
        }),
        loadSystemInstructionDocuments({ documents: options.instructionDocuments, signal }),
        loadInstructionFiles(
          {
            megumiHomePath: options.megumiHomePath,
            workspaceRoot: options.config.environment.workingDirectory,
            workingDirectory: options.config.environment.workingDirectory,
            source: createNodeInstructionSource(),
            ...options.readInstructionPolicy?.(options.workspaceId),
          },
          { signal },
        ),
        options.skills?.createView({ workspaceId: options.workspaceId, signal }),
      ]);
      signal.throwIfAborted();
      if (built.status === 'failed') throw new Error(built.failure.message);
      if (instructions.status !== 'ok')
        throw new Error(
          instructions.status === 'failed'
            ? instructions.failure.message
            : 'Instruction loading was cancelled.',
        );
      if (skills?.status === 'failed') throw new Error('Skill catalog could not be prepared.');
      const memory = options.memory?.task.getPromptMemory(options.memory.executionId());
      const allowedMemoryTools = new Set(memory?.tools.map(tool => tool.name) ?? []);
      const tools = options.memory ? suppliedTools.filter(tool => !tool.name.startsWith('memory_') || allowedMemoryTools.has(tool.name)) : suppliedTools;
      const prepared = {
        systemPrompt: buildSystemPrompt({
          systemInstructions: documents,
          effectiveInstructions: { sources: instructions.sources },
          skills: skills?.view,
          executionEnvironment: options.config.environment,
          tools,
        }) + (memory?.prompt ? `\n\n<automatic_memory>\n${memory.prompt}\n</automatic_memory>` : ''),
        messages: built.materialized.messages,
        tools,
      };
      const tokens = calculatePromptUsage({ prompt: prepared }).tokens;
      if (tokens > options.config.model.contextWindow * options.compactionThresholdRatio) {
        const compacted = await compactCodingHistory({
          options,
          materialized: built.materialized,
          trigger: 'threshold',
          signal,
        });
        signal.throwIfAborted();
        if (compacted.status === 'failed') throw new Error(compacted.error.message);
        if (compacted.status === 'compacted') {
          const current = options.history.getActiveHistory({ session_id: options.sessionId });
          if (current.status === 'failed') throw new Error(current.failure.message);
          const updated = await buildContextMessages({
            history: current.history,
            attachmentReader: options.attachments,
            imageInputSupport: options.config.model.input.includes('image'),
            signal,
          });
          if (updated.status === 'failed') throw new Error(updated.failure.message);
          prepared.messages = updated.materialized.messages;
        }
      }
      return prepared;
    },
  };
}
