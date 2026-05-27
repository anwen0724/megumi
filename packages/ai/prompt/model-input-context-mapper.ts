import type { ModelInputContext, ModelInputContextPart } from '@megumi/shared/model-input-context-contracts';
import type { OpenAICompatibleMessage } from '../types';

export function mapModelInputContextToOpenAICompatibleMessages(
  inputContext: ModelInputContext,
): OpenAICompatibleMessage[] {
  return inputContext.parts.map(mapModelInputContextPartToOpenAICompatibleMessage);
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
