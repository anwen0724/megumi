/* Selects bounded owner facts and materializes them as one provider-neutral AI Context. */
import type {
  AssistantMessage,
  Context as AiContext,
  ContentBlock,
  ImageContent,
  JsonValue,
  Message,
  TextContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from '@megumi/ai';
import type { EffectiveInstructions, SystemInstruction } from '@megumi/instructions';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import {
  conversationItemsFromRun,
  type ConversationItem,
  type ConversationRun,
  type CurrentConversationRun,
} from './conversation-run';

export interface VisibleCompactionSummary {
  readonly compactionId: string;
  readonly content: string;
}

export interface ContextSourceRef {
  readonly sourceType:
    | 'system_instruction'
    | 'agent_instruction'
    | 'skill_catalog'
    | 'used_skill'
    | 'compaction_summary'
    | 'session_message'
    | 'current_run_item'
    | 'tool_definition'
    | 'tool_result';
  readonly sourceId: string;
}

export interface ExecutionEnvironment {
  readonly workingDirectory: string;
  readonly operatingSystem: string;
  readonly shell: string;
}

export interface ActiveContext {
  readonly sessionId: string;
  readonly executionEnvironment: ExecutionEnvironment;
  readonly systemInstructions: SystemInstruction[];
  readonly effectiveInstructions: EffectiveInstructions;
  readonly skillCatalog: SkillCatalogItem[];
  readonly usedSkills: UsedSkillContent[];
  readonly historicalRuns: ConversationRun[];
  readonly currentRun?: CurrentConversationRun;
  readonly compactionSummary?: VisibleCompactionSummary;
  readonly tools: Tool[];
}

export interface ActiveContextFacts extends ActiveContext {
  readonly expectedActiveEntryId: string | null;
}

export function assembleActiveContext(facts: ActiveContext): {
  readonly activeContext: ActiveContext;
  readonly sourceRefs: ContextSourceRef[];
} {
  const activeContext: ActiveContext = Object.freeze({
    sessionId: facts.sessionId,
    executionEnvironment: { ...facts.executionEnvironment },
    systemInstructions: [...facts.systemInstructions],
    effectiveInstructions: {
      sources: [...facts.effectiveInstructions.sources],
    },
    skillCatalog: [...facts.skillCatalog],
    usedSkills: facts.usedSkills.map((skill) => ({ ...skill })),
    historicalRuns: [...facts.historicalRuns],
    ...(facts.currentRun ? { currentRun: facts.currentRun } : {}),
    ...(facts.compactionSummary ? { compactionSummary: facts.compactionSummary } : {}),
    tools: [...facts.tools],
  });
  return { activeContext, sourceRefs: sourceRefsFor(activeContext) };
}

export function buildAiContext(activeContext: ActiveContext): AiContext {
  const conversation = [
    ...activeContext.historicalRuns.flatMap(conversationItemsFromRun),
    ...(activeContext.currentRun
      ? [activeContext.currentRun.userMessage, ...activeContext.currentRun.runItems]
      : []),
  ];
  const messages = referenceMessages(activeContext);
  messages.push(...materializeConversation(conversation));
  for (const skill of activeContext.usedSkills) {
    messages.push(referenceMessage('skill', {
      name: skill.name,
      skillPath: skill.skillPath,
      instructions: skill.content,
    }));
  }
  const systemPrompt = [
    ...activeContext.systemInstructions.map((instruction) => instruction.content),
    ...activeContext.effectiveInstructions.sources.map((source) => source.content),
    formatExecutionEnvironment(activeContext.executionEnvironment),
  ].join('\n\n');
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(activeContext.tools.length > 0 ? { tools: activeContext.tools } : {}),
  };
}

function formatExecutionEnvironment(environment: ExecutionEnvironment): string {
  return [
    'Execution environment:',
    `- Working directory: ${environment.workingDirectory}`,
    `- Operating system: ${environment.operatingSystem}`,
    `- Shell: ${environment.shell}`,
  ].join('\n');
}

function sourceRefsFor(activeContext: ActiveContext): ContextSourceRef[] {
  const refs: ContextSourceRef[] = [
    ...activeContext.systemInstructions.map(({ instructionId }) => ({
      sourceType: 'system_instruction' as const,
      sourceId: instructionId,
    })),
    ...activeContext.effectiveInstructions.sources.map(({ sourceId }) => ({
      sourceType: 'agent_instruction' as const,
      sourceId,
    })),
    ...activeContext.usedSkills.map(({ skillPath }) => ({
      sourceType: 'used_skill' as const,
      sourceId: skillPath,
    })),
    ...activeContext.skillCatalog.map(({ skillPath }) => ({
      sourceType: 'skill_catalog' as const,
      sourceId: skillPath,
    })),
  ];
  if (activeContext.compactionSummary) {
    refs.push({
      sourceType: 'compaction_summary',
      sourceId: activeContext.compactionSummary.compactionId,
    });
  }
  for (const run of activeContext.historicalRuns) {
    refs.push(
      { sourceType: 'session_message', sourceId: run.source.userMessageId },
      ...run.source.responseMessageRefs.map(({ messageId }) => ({
        sourceType: 'session_message' as const,
        sourceId: messageId,
      })),
      ...run.items.flatMap((item) => item.type === 'tool_result'
        ? [{ sourceType: 'tool_result' as const, sourceId: item.toolCallId }]
        : []),
    );
  }
  if (activeContext.currentRun) {
    refs.push({
      sourceType: 'session_message',
      sourceId: activeContext.currentRun.userEntry.entryId,
    });
    activeContext.currentRun.runItems.forEach((item, index) => {
      refs.push(item.type === 'tool_result'
        ? { sourceType: 'tool_result', sourceId: item.toolCallId }
        : {
            sourceType: 'current_run_item',
            sourceId: `${activeContext.currentRun!.runId}:${index}`,
          });
    });
  }
  refs.push(...activeContext.tools.map(({ name }) => ({
    sourceType: 'tool_definition' as const,
    sourceId: name,
  })));
  return refs;
}

function referenceMessages(activeContext: ActiveContext): Message[] {
  const messages: Message[] = [];
  if (activeContext.skillCatalog.length > 0) {
    messages.push(referenceMessage('skill_catalog', activeContext.skillCatalog.map((skill) => ({
      name: skill.name,
      description: skill.description,
      skillPath: skill.skillPath,
    }))));
  }
  if (activeContext.compactionSummary) {
    messages.push(referenceMessage('compaction_summary', activeContext.compactionSummary.content));
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
      while (isIncludedFollowingToolCall(items[index + 1], includedToolCalls)) index += 1;
      continue;
    }
    const content: AssistantMessage['content'] = item.type === 'assistant_message'
      ? item.content.map((block) => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          if (block.type === 'thinking') {
            return { type: 'thinking' as const, thinking: block.thinking };
          }
          return toolCallFrom({
            type: 'tool_call',
            toolCallId: block.id,
            toolName: block.name,
            arguments: parseJson(block.argumentsText),
          });
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

function normalizedAssistantMessage(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'megumi-normalized-history',
    provider: 'megumi',
    model: 'session-history',
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
    ...(item.error ? { details: { error: item.error } } : {}),
    isError: item.status !== 'success',
    timestamp: 0,
  };
}

function contentBlockToAi(block: ContentBlock): TextContent | ImageContent {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'json') return { type: 'text', text: JSON.stringify(block.value) };
  if (block.type === 'file') {
    return {
      type: 'text',
      text: JSON.stringify({
        type: 'attached_file',
        path: block.path,
        ...(block.name ? { name: block.name } : {}),
        ...(block.mediaType ? { mediaType: block.mediaType } : {}),
      }),
    };
  }
  if (block.source.type === 'base64') {
    return { type: 'image', data: block.source.data, mimeType: block.source.mediaType };
  }
  throw new ContextMaterializationError('image');
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

export class ContextMaterializationError extends Error {
  constructor(readonly contentType: 'image') {
    super(`Context contains an unmaterialized ${contentType} block.`);
    this.name = 'ContextMaterializationError';
  }
}
