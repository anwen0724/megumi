/*
 * Converts Agent Run model-call requests into packages/ai client requests.
 * It isolates prompt/tool-set mapping from Model Call Service control flow.
 */
import type { AiCallRequest, ConversationMessage, ToolSet as AiToolSet } from '@megumi/ai';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PromptMessage } from '../../context';
import type { ModelCallRequest, ToolSet } from '../contracts/model-call-contracts';

export function mapModelCallToAiRequest(
  request: ModelCallRequest,
): AiCallRequest {
  const systemPrompt = request.prompt.messages.find((message) => message.role === 'system')?.content;

  return {
    model: {
      providerId: request.model_config.provider_id,
      protocol: request.model_config.protocol,
      modelId: request.model_config.model_id,
      ...(request.model_config.base_url ? { baseUrl: request.model_config.base_url } : {}),
    },
    context: {
      ...(systemPrompt ? { systemPrompt } : {}),
      messages: request.prompt.messages
        .filter((message) => message.role !== 'system')
        .map(promptMessageToConversationMessage),
    },
    ...(request.tool_set ? { toolSet: toolSetToAiToolSet(request.tool_set) } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.model_config.api_key ? {
      credential: { type: 'api_key', value: request.model_config.api_key },
    } : {}),
    metadata: request.owner.type === 'agent_run'
      ? { runId: request.owner.run_id }
      : { sessionId: request.owner.session_id },
  };
}

function promptMessageToConversationMessage(message: PromptMessage): ConversationMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
    };
  }

  return {
    role: 'user',
    content: message.content,
  };
}

function toolSetToAiToolSet(toolSet: ToolSet): AiToolSet {
  return toolSet.items.map((item) => ({
    name: item.name,
    description: item.description,
    inputSchema: item.input_schema as JsonObject,
  }));
}
