// Maps current ModelStepRuntimeRequest into pure AI model, context, and ToolSet inputs.
import type { ModelInputContextPart, ModelStepRuntimeRequest, ToolContinuationPart } from '@megumi/shared/model';
import type { ToolDefinition } from '@megumi/shared/tool';
import type { AiModel, ConversationMessage, ModelContext, ToolSet } from '@megumi/ai';
import type { ProviderRuntimeConfig } from './model-call-contract';

export function mapModelCallToAiInput(input: {
  request: ModelStepRuntimeRequest;
  config: ProviderRuntimeConfig;
}): {
  model: AiModel;
  context: ModelContext;
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

export const mapModelStepToAiInput = mapModelCallToAiInput;

function mapModelInputContext(parts: ModelInputContextPart[]): ModelContext {
  const messages: ConversationMessage[] = [];
  const systemPromptParts: string[] = [];
  const nativeReplay = mapNativeToolReplay(parts);
  const consumedPartIds = new Set(nativeReplay.consumedPartIds);

  for (const part of parts) {
    if (consumedPartIds.has(part.partId)) {
      continue;
    }

    const mapped = mapPartToMessage(part);
    if (!mapped) {
      continue;
    }

    if (mapped.role === 'system') {
      systemPromptParts.push(mapped.content);
      continue;
    }

    messages.push(mapped);
  }

  messages.push(...nativeReplay.messages);

  return {
    ...(systemPromptParts.length > 0 ? { systemPrompt: systemPromptParts.join('\n\n') } : {}),
    messages,
  };
}

function mapPartToMessage(part: ModelInputContextPart):
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | undefined {
  switch (part.kind) {
    case 'instruction':
    case 'session':
    case 'tool_continuation':
    case 'runtime_constraint':
    case 'memory':
      return { role: 'system', content: part.text };
    case 'current_turn':
      return { role: part.role === 'host' ? 'system' : 'user', content: part.text };
  }
}

function mapNativeToolReplay(parts: ModelInputContextPart[]): {
  messages: ConversationMessage[];
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

  const providerStateByModelStepId = new Map<string, string>();
  for (const part of toolParts) {
    if (part.modelStepId && part.providerStateText) {
      providerStateByModelStepId.set(
        part.modelStepId,
        `${providerStateByModelStepId.get(part.modelStepId) ?? ''}${part.providerStateText}`,
      );
    }
  }

  const messages: ConversationMessage[] = [];
  const consumedPartIds = new Set<string>();
  const replayedModelStepIds = new Set<string>();
  let currentModelStepId: string | undefined;
  let currentToolCalls: ToolContinuationPart[] = [];
  let currentToolResults: Array<{ toolCall?: ToolContinuationPart; toolResult: ToolContinuationPart }> = [];

  const flush = () => {
    if (currentToolCalls.length > 0) {
      const thinking = currentModelStepId ? providerStateByModelStepId.get(currentModelStepId) : undefined;
      messages.push({
        role: 'assistant',
        content: [
          ...(thinking ? [{ type: 'thinking' as const, thinking }] : []),
          ...currentToolCalls.map((toolCall) => ({
            type: 'toolCall' as const,
            id: providerToolCallId(toolCall),
            name: String(toolCall.toolName),
            argumentsText: JSON.stringify(toolCall.toolInput ?? {}),
          })),
        ],
      });
      if (currentModelStepId) {
        replayedModelStepIds.add(currentModelStepId);
      }
    }

    for (const { toolCall, toolResult } of currentToolResults) {
      messages.push({
        role: 'toolResult',
        toolCallId: providerToolCallId(toolCall ?? toolResult),
        content: toolResult.toolResultContent ?? toolResult.text,
      });
    }

    currentModelStepId = undefined;
    currentToolCalls = [];
    currentToolResults = [];
  };

  for (const toolResultPart of toolResultParts) {
    const toolCall = toolCallById.get(String(toolResultPart.toolCallId));
    const modelStepId = toolCall?.modelStepId;

    if (currentToolResults.length > 0 && modelStepId !== currentModelStepId) {
      flush();
    }

    currentModelStepId = modelStepId;
    if (toolCall) {
      currentToolCalls.push(toolCall);
      consumedPartIds.add(toolCall.partId);
    }
    currentToolResults.push({ toolCall, toolResult: toolResultPart });
    consumedPartIds.add(toolResultPart.partId);
  }

  flush();

  for (const part of toolParts) {
    if (part.providerStateText && part.modelStepId && replayedModelStepIds.has(part.modelStepId)) {
      consumedPartIds.add(part.partId);
    }
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
