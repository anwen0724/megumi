import type { ChatMessage, ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';
import type {
  OpenAICompatibleChatCompletionRequestBody,
  OpenAICompatibleMessage,
  OpenAICompatibleToolDefinition,
} from '../types';
import { mapModelInputContextToOpenAICompatibleMessages } from './model-input-context-mapper';
import { buildSystemPrompt } from './system-prompt';

type ModelStepPromptRequest = Omit<Partial<ModelStepRuntimeRequest>, 'inputContext' | 'modelId'> & {
  inputContext: ModelInputContext;
  modelId: ModelStepRuntimeRequest['modelId'];
};

export function mapModelStepToOpenAICompatibleRequest(request: ModelStepRuntimeRequest): OpenAICompatibleChatCompletionRequestBody;
export function mapModelStepToOpenAICompatibleRequest(request: ModelStepPromptRequest): OpenAICompatibleChatCompletionRequestBody;
export function mapModelStepToOpenAICompatibleRequest(
  request: ModelStepRuntimeRequest | ModelStepPromptRequest,
): OpenAICompatibleChatCompletionRequestBody {
  const tools = request.toolDefinitions?.map(mapToolDefinition);

  return {
    model: String(request.modelId),
    messages: mapModelStepToOpenAICompatibleMessages({
      ...request,
      inputContext: request.inputContext!,
    }),
    stream: true,
    stream_options: {
      include_usage: true,
    },
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
}

export function mapModelStepToOpenAICompatibleMessages(request: ModelStepPromptRequest) {
  return mapModelInputContextToOpenAICompatibleMessages(request.inputContext);
}

export function mapToOpenAICompatibleMessages(request: ChatRuntimeRequest): OpenAICompatibleMessage[] {
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(request.context),
    },
  ];

  for (const message of request.messages) {
    messages.push(mapMessage(message));
  }

  return messages;
}

function mapMessage(message: ChatMessage): OpenAICompatibleMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
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
