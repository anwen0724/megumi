/*
 * Materializes the complete Context Prompt into the provider-neutral AI request.
 * Model calling and request counting share this single mapping boundary.
 */
import type {
  AiCallRequest,
  AssistantContentBlock,
  ContentBlock,
  ContextMessage,
  ConversationItem,
  ConversationMessage,
  JsonValue,
  ToolSet as AiToolSet,
} from '@megumi/ai';
import type { Prompt } from '../../context';
import type { ModelCallRequest, ModelCallConfig } from '../contracts/model-call-contracts';

export type PromptAiRequestInput = {
  prompt: Prompt;
  model_config: ModelCallConfig;
  signal?: AbortSignal;
};

export class UnsupportedModelContentError extends Error {
  readonly contentType: 'image' | 'file';

  constructor(contentType: 'image' | 'file') {
    super(`Model Call does not support ${contentType} content materialization.`);
    this.name = 'UnsupportedModelContentError';
    this.contentType = contentType;
  }
}

export class PromptMaterializationError extends Error {
  readonly reason: 'memory_requires_current_user';

  constructor(reason: 'memory_requires_current_user') {
    super('Prompt memory recall requires a current user message.');
    this.name = 'PromptMaterializationError';
    this.reason = reason;
  }
}

export function mapPromptToAiRequest(request: PromptAiRequestInput): AiCallRequest {
  assertSupportedPromptContent(request.prompt);

  return {
    model: {
      providerId: request.model_config.provider_id,
      protocol: request.model_config.protocol,
      modelId: request.model_config.model_id,
      ...(request.model_config.base_url ? { baseUrl: request.model_config.base_url } : {}),
    },
    context: {
      systemPrompt: materializeInstructions(request.prompt),
      messages: materializePromptMessages(request.prompt),
    },
    tools: promptToolsToAiToolSet(request.prompt.tools),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.model_config.api_key ? {
      credential: { type: 'api_key', value: request.model_config.api_key },
    } : {}),
  };
}

export function mapModelCallToAiRequest(request: ModelCallRequest): AiCallRequest {
  return mapPromptToAiRequest({
    prompt: request.prompt,
    model_config: request.model_config,
    ...(request.signal ? { signal: request.signal } : {}),
  });
}

function materializeInstructions(prompt: Prompt): string {
  return [
    ...prompt.instructions.system.map((instruction) => instruction.content),
    ...prompt.instructions.agentInstructions.sources.map((source) => source.content),
  ].join('\n\n');
}

function materializePromptMessages(prompt: Prompt): ConversationMessage[] {
  const references: ContextMessage[] = [];

  if (prompt.referenceContext.skillCatalog.length > 0) {
    references.push({
      role: 'context',
      kind: 'skill_catalog',
      content: prompt.referenceContext.skillCatalog.map((skill) => ({
        name: skill.name,
        description: skill.description,
        skillPath: skill.skillPath,
      })),
    });
  }

  if (prompt.referenceContext.compactionSummary) {
    references.push({
      role: 'context',
      kind: 'compaction_summary',
      content: prompt.referenceContext.compactionSummary.content,
    });
  }

  const skillMessages: ContextMessage[] = prompt.runContext.skills.map((skill) => ({
    role: 'context',
    kind: 'skill',
    content: {
      name: skill.name,
      skillPath: skill.skillPath,
      instructions: skill.content,
    },
  }));

  const memory = prompt.referenceContext.memoryRecall;
  if (!memory) return [...references, ...materializeConversation(prompt.conversation), ...skillMessages];

  const currentUserIndex = findLastUserMessageIndex(prompt.conversation);
  if (currentUserIndex < 0) {
    throw new PromptMaterializationError('memory_requires_current_user');
  }

  const memoryMessage: ContextMessage = {
    role: 'context',
    kind: 'memory_recall',
    content: memory.items.flatMap((item) => item.content.map(contentBlockToJson)),
  };

  // The last user item is the current turn boundary. Memory belongs immediately
  // before it, while any current-run tool protocol items remain after it.
  return [
    ...references,
    ...materializeConversation(prompt.conversation.slice(0, currentUserIndex)),
    memoryMessage,
    ...materializeConversation(prompt.conversation.slice(currentUserIndex)),
    ...skillMessages,
  ];
}

function findLastUserMessageIndex(conversation: ConversationItem[]): number {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.type === 'user_message') return index;
  }
  return -1;
}

function contentBlockToJson(block: ContentBlock): JsonValue {
  if (block.type === 'text') return { type: 'text' as const, text: block.text };
  if (block.type === 'json') return { type: 'json' as const, value: block.value };
  if (block.type === 'image' && block.source.type === 'base64') {
    return { type: 'image', source: block.source };
  }
  throw new UnsupportedModelContentError(block.type);
}

function materializeConversation(conversation: ConversationItem[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (let index = 0; index < conversation.length; index += 1) {
    const item = conversation[index]!;

    if (item.type === 'context') {
      messages.push({ role: 'context', kind: item.kind, content: item.content });
      continue;
    }

    if (item.type === 'user_message') {
      messages.push({ role: 'user', content: materializeContentBlocks(item.content) });
      continue;
    }

    if (item.type === 'tool_result') {
      messages.push(toolResultToMessage(item));
      continue;
    }

    const content: AssistantContentBlock[] = item.type === 'assistant_message'
      ? item.content.map(contentBlockToAssistantText)
      : [toolCallToContentBlock(item)];

    while (conversation[index + 1]?.type === 'tool_call') {
      index += 1;
      content.push(toolCallToContentBlock(
        conversation[index] as Extract<ConversationItem, { type: 'tool_call' }>,
      ));
    }

    messages.push({ role: 'assistant', content });
  }

  return messages;
}

function contentBlockToAssistantText(block: ContentBlock): AssistantContentBlock {
  if (block.type === 'text') return block;
  if (block.type === 'json') return { type: 'text', text: JSON.stringify(block.value) };
  throw new UnsupportedModelContentError(block.type);
}

function toolCallToContentBlock(
  item: Extract<ConversationItem, { type: 'tool_call' }>,
): AssistantContentBlock {
  return {
    type: 'toolCall',
    id: item.toolCallId,
    name: item.toolName,
    argumentsText: JSON.stringify(item.arguments),
  };
}

function toolResultToMessage(
  item: Extract<ConversationItem, { type: 'tool_result' }>,
): ConversationMessage {
  return {
    role: 'toolResult',
    toolCallId: item.toolCallId,
    content: JSON.stringify({
      toolName: item.toolName,
      status: item.status,
      content: item.content.map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'json') return JSON.stringify(block.value);
        throw new UnsupportedModelContentError(block.type);
      }).join('\n'),
    }),
  };
}

function materializeContentBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map((block) => {
    if (block.type === 'text' || block.type === 'json') return block;
    if (block.type === 'image' && block.source.type === 'base64') return block;
    throw new UnsupportedModelContentError(block.type);
  });
}

function assertSupportedPromptContent(prompt: Prompt): void {
  const blocks = [
    ...(prompt.referenceContext.memoryRecall?.items.flatMap((item) => item.content) ?? []),
    ...prompt.conversation.flatMap((item) => (
      item.type === 'user_message'
      || item.type === 'assistant_message'
      || item.type === 'tool_result'
        ? item.content
        : []
    )),
  ];

  for (const block of blocks) {
    if (block.type === 'file' || (block.type === 'image' && block.source.type !== 'base64')) {
      throw new UnsupportedModelContentError(block.type);
    }
  }
}

function promptToolsToAiToolSet(tools: Prompt['tools']): AiToolSet {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
