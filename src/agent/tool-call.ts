// Converts assistant tool-call content blocks into real ToolCall boundary facts for tools.
import type { AssistantMessage } from '../ai';
import type { JsonObject } from '../shared';
import type { ToolCall } from '../tools';

export function createToolCallsFromAssistantMessage(message: AssistantMessage): ToolCall[] {
  return message.content
    .filter((block) => block.type === 'toolCall')
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: parseToolArguments(block.argumentsText),
    }));
}

function parseToolArguments(argumentsText: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (isJsonObject(parsed)) {
      return parsed;
    }
    return { __invalidJsonArgumentsText: argumentsText };
  } catch {
    return { __invalidJsonArgumentsText: argumentsText };
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
