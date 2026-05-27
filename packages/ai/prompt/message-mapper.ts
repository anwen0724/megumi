import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';
import type {
  OpenAICompatibleChatCompletionRequestBody,
  OpenAICompatibleToolDefinition,
} from '../types';
import { mapModelInputContextToOpenAICompatibleMessages } from './model-input-context-mapper';

export function mapModelStepToOpenAICompatibleRequest(
  request: ModelStepRuntimeRequest,
): OpenAICompatibleChatCompletionRequestBody {
  const tools = request.toolDefinitions?.map(mapToolDefinition);

  return {
    model: String(request.modelId),
    messages: mapModelStepToOpenAICompatibleMessages(request),
    stream: true,
    stream_options: {
      include_usage: true,
    },
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
}

export function mapModelStepToOpenAICompatibleMessages(request: ModelStepRuntimeRequest) {
  return mapModelInputContextToOpenAICompatibleMessages(request.inputContext);
}

function mapToolDefinition(tool: ToolDefinition): OpenAICompatibleToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
