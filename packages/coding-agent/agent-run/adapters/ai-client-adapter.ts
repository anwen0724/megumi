/*
 * Materializes the complete Context Prompt into the provider-neutral AI request.
 * Model calling and request counting share this single mapping boundary.
 */
import type {
  AiCallRequest,
  ContentBlock,
  ContextMessage,
  ConversationItem,
  ConversationMessage,
  JsonValue,
  ToolSet as AiToolSet,
} from '@megumi/ai';
import type { Prompt } from '../../context';
import type {
  ModelCallMessage,
  ModelCallRequest,
  ModelCallConfig,
  ToolSet,
} from '../contracts/model-call-contracts';

export type PromptAiRequestInput = {
  prompt: Prompt;
  model_config: ModelCallConfig;
  tool_set: ToolSet;
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
    toolSet: promptToolsToAiToolSet(request.prompt.tools),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.model_config.api_key ? {
      credential: { type: 'api_key', value: request.model_config.api_key },
    } : {}),
  };
}

export function mapModelCallToAiRequest(request: ModelCallRequest): AiCallRequest {
  const baseRequest = mapPromptToAiRequest({
    prompt: request.prompt,
    model_config: request.model_config,
    tool_set: request.tool_set ?? { items: [] },
    ...(request.signal ? { signal: request.signal } : {}),
  });

  return {
    ...baseRequest,
    context: {
      ...baseRequest.context,
      messages: [
        ...baseRequest.context.messages,
        ...(request.model_call_messages ?? []).map(modelCallMessageToConversationMessage),
      ],
    },
  };
}

function materializeInstructions(prompt: Prompt): string {
  return [
    ...prompt.instructions.system.map((instruction) => instruction.content),
    ...prompt.instructions.agentInstructions.sources.map((source) => source.content),
    ...prompt.instructions.activatedSkills.map((skill) => skill.content),
  ].join('\n\n');
}

function materializePromptMessages(prompt: Prompt): ConversationMessage[] {
  const conversation = prompt.conversation.flatMap(conversationItemToMessages);
  const references: ContextMessage[] = [];

  if (prompt.referenceContext.skillCatalog.length > 0) {
    references.push({
      role: 'context',
      kind: 'skill_catalog',
      content: prompt.referenceContext.skillCatalog.map((skill) => ({
        skillId: skill.skillId,
        description: skill.description,
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

  const memory = prompt.referenceContext.memoryRecall;
  if (!memory) return [...references, ...conversation];

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
    ...conversation.slice(0, currentUserIndex),
    memoryMessage,
    ...conversation.slice(currentUserIndex),
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
  throw new UnsupportedModelContentError(block.type);
}

function conversationItemToMessages(item: ConversationItem): ConversationMessage[] {
  if (item.type === 'user_message') {
    return [{ role: 'user', content: materializeContentBlocks(item.content) }];
  }

  if (item.type === 'assistant_message') {
    return [{
      role: 'assistant',
      content: [{ type: 'text', text: materializeContentBlocks(item.content) }],
    }];
  }

  if (item.type === 'tool_call') {
    return [{
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: item.toolCallId,
        name: item.toolName,
        argumentsText: JSON.stringify(item.arguments),
      }],
    }];
  }

  return [{
    role: 'toolResult',
    toolCallId: item.toolCallId,
    content: JSON.stringify({
      toolName: item.toolName,
      status: item.status,
      content: materializeContentBlocks(item.content),
    }),
  }];
}

function materializeContentBlocks(content: ContentBlock[]): string {
  return content.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'json') return JSON.stringify(block.value);
    throw new UnsupportedModelContentError(block.type);
  }).join('\n');
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
    if (block.type === 'image' || block.type === 'file') {
      throw new UnsupportedModelContentError(block.type);
    }
  }
}

function modelCallMessageToConversationMessage(message: ModelCallMessage): ConversationMessage {
  if (message.role === 'tool_result') {
    return {
      role: 'toolResult',
      toolCallId: message.tool_call_id,
      content: message.content,
    };
  }

  return {
    role: 'assistant',
    content: [
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...message.tool_calls.map((toolCall) => ({
        type: 'toolCall' as const,
        id: toolCall.tool_call_id,
        name: toolCall.tool_name,
        argumentsText: toolCall.arguments_text,
      })),
    ],
  };
}

function promptToolsToAiToolSet(tools: Prompt['tools']): AiToolSet {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
