import type { ChatMessage, ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { OpenAICompatibleMessage } from '../types';
import { buildSystemPrompt } from './system-prompt';

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
