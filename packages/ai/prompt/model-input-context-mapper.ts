import type {
  ModelInputContext,
  ModelInputContextPart,
  ToolContinuationPart,
} from '@megumi/shared/model-input-context-contracts';
import type { OpenAICompatibleMessage, OpenAICompatibleToolCall } from '../types';

export function mapModelInputContextToOpenAICompatibleMessages(
  inputContext: ModelInputContext,
): OpenAICompatibleMessage[] {
  const nativeToolReplay = mapNativeToolReplay(inputContext.parts);
  const nativeReplayPartIds = new Set(nativeToolReplay.consumedPartIds);

  return [
    ...inputContext.parts
      .filter((part) => !nativeReplayPartIds.has(part.partId))
      .map(mapModelInputContextPartToOpenAICompatibleMessage),
    ...nativeToolReplay.messages,
  ];
}

function mapNativeToolReplay(parts: ModelInputContextPart[]): {
  messages: OpenAICompatibleMessage[];
  consumedPartIds: string[];
} {
  const toolParts = parts.filter((part): part is ToolContinuationPart => part.kind === 'tool_continuation');
  const toolUseParts = toolParts.filter(hasNativeToolUseFields);
  const toolResultParts = toolParts.filter(hasNativeToolResultFields);

  if (toolUseParts.length === 0 || toolResultParts.length === 0) {
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

  const toolUseById = new Map(toolUseParts.map((part) => [String(part.toolUseId), part]));
  const messages: OpenAICompatibleMessage[] = [];
  const consumedPartIds = new Set<string>();
  const replayedModelStepIds = new Set<string>();
  let currentModelStepId: string | undefined;
  let currentToolCalls: ToolContinuationPart[] = [];
  let currentToolResults: Array<{
    toolUse?: ToolContinuationPart;
    toolResult: ToolContinuationPart;
  }> = [];

  const flush = () => {
    if (currentToolCalls.length > 0) {
      const reasoningContent = currentModelStepId
        ? providerStateByModelStepId.get(currentModelStepId)
        : undefined;
      messages.push({
        role: 'assistant',
        content: '',
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        tool_calls: currentToolCalls.map(mapToolUsePartToOpenAICompatibleToolCall),
      });
      if (currentModelStepId) {
        replayedModelStepIds.add(currentModelStepId);
      }
    }

    for (const { toolUse, toolResult } of currentToolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: providerToolUseId(toolUse ?? toolResult),
        content: toolResult.toolResultContent ?? toolResult.text,
      });
    }

    currentModelStepId = undefined;
    currentToolCalls = [];
    currentToolResults = [];
  };

  for (const toolResultPart of toolResultParts) {
    const toolUse = toolUseById.get(String(toolResultPart.toolUseId));
    const modelStepId = toolUse?.modelStepId;

    if (currentToolResults.length > 0 && modelStepId !== currentModelStepId) {
      flush();
    }

    currentModelStepId = modelStepId;
    if (toolUse) {
      currentToolCalls.push(toolUse);
      consumedPartIds.add(toolUse.partId);
    }
    currentToolResults.push({ toolUse, toolResult: toolResultPart });
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

function hasNativeToolUseFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolUseId && part.toolName && part.toolInput !== undefined);
}

function hasNativeToolResultFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolUseId && part.toolResultId && part.toolResultContent !== undefined);
}

function mapToolUsePartToOpenAICompatibleToolCall(part: ToolContinuationPart): OpenAICompatibleToolCall {
  return {
    id: providerToolUseId(part),
    type: 'function',
    function: {
      name: String(part.toolName),
      arguments: JSON.stringify(part.toolInput ?? {}),
    },
  };
}

function providerToolUseId(part: ToolContinuationPart): string {
  return String(part.providerToolUseId ?? part.toolUseId);
}

function mapModelInputContextPartToOpenAICompatibleMessage(
  part: ModelInputContextPart,
): OpenAICompatibleMessage {
  switch (part.kind) {
    case 'instruction':
      return {
        role: 'system',
        content: part.text,
      };
    case 'current_turn':
      return {
        role: part.role === 'host' ? 'system' : 'user',
        content: part.text,
      };
    case 'session':
      return {
        role: 'system',
        content: part.text,
      };
    case 'tool_continuation':
      return {
        role: 'system',
        content: part.text,
      };
    case 'runtime_constraint':
      return {
        role: 'system',
        content: part.text,
      };
  }
}
