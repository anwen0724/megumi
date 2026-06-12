import type {
  ModelInputContext,
  ModelInputContextPart,
  ToolContinuationPart,
} from '@megumi/shared/model';
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

  const messages: OpenAICompatibleMessage[] = [];
  const consumedPartIds = new Set<string>();
  const replayedModelStepIds = new Set<string>();
  let currentModelStepId: string | undefined;
  let currentToolCalls: ToolContinuationPart[] = [];
  let currentToolResults: Array<{
    toolCall?: ToolContinuationPart;
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
        tool_calls: currentToolCalls.map(mapToolCallPartToOpenAICompatibleToolCall),
      });
      if (currentModelStepId) {
        replayedModelStepIds.add(currentModelStepId);
      }
    }

    for (const { toolCall, toolResult } of currentToolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: providerToolCallId(toolCall ?? toolResult),
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

function mapToolCallPartToOpenAICompatibleToolCall(part: ToolContinuationPart): OpenAICompatibleToolCall {
  return {
    id: providerToolCallId(part),
    type: 'function',
    function: {
      name: String(part.toolName),
      arguments: JSON.stringify(part.toolInput ?? {}),
    },
  };
}

function providerToolCallId(part: ToolContinuationPart): string {
  return String(part.providerToolCallId ?? part.toolCallId);
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
    case 'memory':
      return {
        role: 'system',
        content: part.text,
      };
  }
}

