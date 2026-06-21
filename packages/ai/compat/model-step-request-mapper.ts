// Maps current ModelStepRuntimeRequest into pure AI model, context, and ToolSet inputs.
import type { ModelStepRuntimeRequest, ModelInputContextPart, ToolContinuationPart } from '@megumi/shared/model';
import type { ToolDefinition } from '@megumi/shared/tool';
import type { Message, Model, ModelContextInput, ToolSet } from '../index';
import type { ProviderRuntimeConfig } from './model-step-types';

export function mapModelStepToAiInput(input: {
  request: ModelStepRuntimeRequest;
  config: ProviderRuntimeConfig;
}): {
  model: Model;
  context: ModelContextInput;
  toolSet?: ToolSet;
} {
  return {
    model: {
      providerId: input.config.providerId,
      modelId: String(input.request.modelId || input.config.defaultModelId),
      capabilities: {
        streaming: true,
        toolCalls: true,
        thinking: true,
      },
    },
    context: mapModelInputContext(input.request.inputContext.parts),
    ...(input.request.toolDefinitions && input.request.toolDefinitions.length > 0
      ? { toolSet: mapToolDefinitions(input.request.toolDefinitions) }
      : {}),
  };
}

function mapModelInputContext(parts: ModelInputContextPart[]): ModelContextInput {
  const messages: Message[] = [];
  const nativeReplay = mapNativeToolReplay(parts);
  const consumedPartIds = new Set(nativeReplay.consumedPartIds);

  for (const part of parts) {
    if (consumedPartIds.has(part.partId)) {
      continue;
    }

    const message = mapPartToMessage(part);
    if (message) {
      messages.push(message);
    }
  }

  messages.push(...nativeReplay.messages);

  return { messages };
}

function mapPartToMessage(part: ModelInputContextPart): Message | undefined {
  switch (part.kind) {
    case 'instruction':
    case 'session':
    case 'tool_continuation':
    case 'runtime_constraint':
    case 'memory':
      return { role: 'user', content: part.text };
    case 'current_turn':
      return { role: 'user', content: part.text };
  }
}

function mapNativeToolReplay(parts: ModelInputContextPart[]): {
  messages: Message[];
  consumedPartIds: string[];
} {
  const toolParts = parts.filter((part): part is ToolContinuationPart => part.kind === 'tool_continuation');
  const toolCallParts = toolParts.filter(hasNativeToolCallFields);
  const toolCallById = new Map(toolCallParts.map((part) => [String(part.toolCallId), part]));
  const toolResultParts = toolParts
    .filter(hasNativeToolResultFields)
    .filter((part) => toolCallById.has(String(part.toolCallId)));

  if (toolCallParts.length === 0 || toolResultParts.length === 0) {
    return { messages: [], consumedPartIds: [] };
  }

  const messages: Message[] = [];
  const consumedPartIds = new Set<string>();
  for (const toolResult of toolResultParts) {
    const toolCall = toolCallById.get(String(toolResult.toolCallId));
    if (!toolCall) {
      continue;
    }

    messages.push({
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: providerToolCallId(toolCall),
        name: String(toolCall.toolName),
        argumentsText: JSON.stringify(toolCall.toolInput ?? {}),
      }],
    });
    messages.push({
      role: 'toolResult',
      toolCallId: providerToolCallId(toolCall),
      content: toolResult.toolResultContent ?? toolResult.text,
    });
    consumedPartIds.add(toolCall.partId);
    consumedPartIds.add(toolResult.partId);
  }

  return {
    messages,
    consumedPartIds: [...consumedPartIds],
  };
}

function hasNativeToolCallFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolCallId && part.toolName && part.toolInput !== undefined);
}

function hasNativeToolResultFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolCallId && part.toolResultId && part.toolResultContent !== undefined);
}

function providerToolCallId(part: ToolContinuationPart): string {
  return String(part.providerToolCallId ?? part.toolCallId);
}

function mapToolDefinitions(toolDefinitions: ToolDefinition[]): ToolSet {
  return toolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
