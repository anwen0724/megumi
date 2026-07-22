/*
 * Materializes Context-owned facts once into the Context consumed directly by packages/ai.
 */
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from '@megumi/ai';
import type { ContentBlock } from '../../../model-content';
import type { JsonValue } from '../../../shared-json';
import type { ActiveContext } from '../../domain/model/active-context';
import type { ConversationItem } from '../../domain/model/conversation-run';
import { conversationItemsFromRun } from './conversation-run-items';

const NORMALIZED_HISTORY_SOURCE = {
  api: 'megumi-normalized-history',
  provider: 'megumi',
  model: 'session-history',
} as const;

export class ContextMaterializationError extends Error {
  constructor(readonly contentType: 'image' | 'file') {
    super(`Context contains an unmaterialized ${contentType} block.`);
    this.name = 'ContextMaterializationError';
  }
}

export function buildContext(activeContext: ActiveContext): Context {
  const conversation = [
    ...activeContext.historicalRuns.flatMap(conversationItemsFromRun),
    ...(activeContext.currentRun
      ? [activeContext.currentRun.userMessage, ...activeContext.currentRun.runItems]
      : []),
  ];
  const messages = materializeReferenceMessages(activeContext);
  const memory = activeContext.referenceContext.memoryRecall;

  if (memory && activeContext.currentRun) {
    const currentUserIndex = findLastUserItemIndex(conversation);
    if (currentUserIndex < 0) {
      throw new Error('Memory recall requires a current user message.');
    }
    messages.push(
      ...materializeConversation(conversation.slice(0, currentUserIndex)),
      referenceMessage('memory_recall', memory.items.flatMap((item) => item.content.map(contentBlockToReference))),
      ...materializeConversation(conversation.slice(currentUserIndex)),
    );
  } else {
    messages.push(...materializeConversation(conversation));
  }

  for (const skill of activeContext.runContext.skills) {
    messages.push(referenceMessage('skill', {
      name: skill.name,
      skillPath: skill.skillPath,
      instructions: skill.content,
    }));
  }

  const systemPrompt = [
    ...activeContext.instructions.system.map((instruction) => instruction.content),
    ...activeContext.instructions.agentInstructions.sources.map((source) => source.content),
  ].join('\n\n');

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(activeContext.tools.length > 0 ? { tools: activeContext.tools } : {}),
  };
}

function materializeReferenceMessages(activeContext: ActiveContext): Message[] {
  const messages: Message[] = [];
  if (activeContext.referenceContext.skillCatalog.length > 0) {
    messages.push(referenceMessage('skill_catalog', activeContext.referenceContext.skillCatalog.map((skill) => ({
      name: skill.name,
      description: skill.description,
      skillPath: skill.skillPath,
    }))));
  }
  if (activeContext.referenceContext.compactionSummary) {
    messages.push(referenceMessage(
      'compaction_summary',
      activeContext.referenceContext.compactionSummary.content,
    ));
  }
  return messages;
}

function referenceMessage(kind: string, content: unknown): Message {
  return {
    role: 'user',
    content: JSON.stringify({ type: 'reference_context', kind, content }),
    timestamp: 0,
  };
}

function materializeConversation(items: ConversationItem[]): Message[] {
  const messages: Message[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.type === 'context') {
      messages.push(referenceMessage(item.kind, item.content));
      continue;
    }
    if (item.type === 'user_message') {
      messages.push({ role: 'user', content: item.content.map(contentBlockToAi), timestamp: 0 });
      continue;
    }
    if (item.type === 'tool_result') {
      messages.push(toolResultMessage(item));
      continue;
    }
    if (item.type === 'assistant_message' && item.modelMessage) {
      messages.push(item.modelMessage);
      const includedToolCalls = new Set(item.modelMessage.content.flatMap((block) => (
        block.type === 'toolCall' ? [block.id] : []
      )));
      while (isIncludedFollowingToolCall(items[index + 1], includedToolCalls)) {
        index += 1;
      }
      continue;
    }

    const content: AssistantMessage['content'] = item.type === 'assistant_message'
      ? item.content.map((block) => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          if (block.type === 'thinking') return { type: 'thinking' as const, thinking: block.thinking };
          return toolCallFrom(itemFromAssistantBlock(block));
        })
      : [toolCallFrom(item)];

    while (items[index + 1]?.type === 'tool_call') {
      index += 1;
      content.push(toolCallFrom(items[index] as Extract<ConversationItem, { type: 'tool_call' }>));
    }
    messages.push(normalizedAssistantMessage(content));
  }
  return messages;
}

function isIncludedFollowingToolCall(
  item: ConversationItem | undefined,
  includedToolCalls: ReadonlySet<string>,
): item is Extract<ConversationItem, { type: 'tool_call' }> {
  return item?.type === 'tool_call' && includedToolCalls.has(item.toolCallId);
}

function itemFromAssistantBlock(
  block: Extract<ConversationItem, { type: 'assistant_message' }>['content'][number],
): Extract<ConversationItem, { type: 'tool_call' }> {
  if (block.type !== 'toolCall') throw new Error('Expected a Tool Call block.');
  return {
    type: 'tool_call',
    toolCallId: block.id,
    toolName: block.name,
    arguments: parseJson(block.argumentsText),
  };
}

function normalizedAssistantMessage(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    ...NORMALIZED_HISTORY_SOURCE,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  };
}

function toolCallFrom(item: Extract<ConversationItem, { type: 'tool_call' }>): ToolCall {
  return {
    type: 'toolCall',
    id: item.toolCallId,
    name: item.toolName,
    arguments: jsonObject(item.arguments),
    ...(item.thoughtSignature ? { thoughtSignature: item.thoughtSignature } : {}),
  };
}

function toolResultMessage(item: Extract<ConversationItem, { type: 'tool_result' }>): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    content: item.content.map(contentBlockToAi),
    isError: item.status === 'failure',
    timestamp: 0,
  };
}

function contentBlockToAi(block: ContentBlock): TextContent | ImageContent {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'json') return { type: 'text', text: JSON.stringify(block.value) };
  if (block.type === 'image' && block.source.type === 'base64') {
    return { type: 'image', data: block.source.data, mimeType: block.source.mediaType };
  }
  throw new ContextMaterializationError(block.type);
}

function contentBlockToReference(block: ContentBlock): unknown {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'json') return { type: 'json', value: block.value };
  if (block.type === 'image' && block.source.type === 'base64') {
    return { type: 'image', data: block.source.data, mimeType: block.source.mediaType };
  }
  throw new ContextMaterializationError(block.type);
}

function findLastUserItemIndex(items: ConversationItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'user_message') return index;
  }
  return -1;
}

function parseJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function jsonObject(value: JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}
