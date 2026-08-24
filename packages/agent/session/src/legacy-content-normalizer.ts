/*
 * Normalizes legacy persisted Session message shapes on read. Historical
 * records were written by earlier payload schemas (single `content` user
 * messages, ToolCall `argumentsText` strings); this module projects them onto
 * the current strict payload shapes without touching the stored rows. Every
 * future legacy persisted-shape compatibility must live here.
 */
import type { SessionAssistantContent } from './session-message';

/**
 * Projects a legacy user message payload that stored a single `content` array
 * onto the current display_content/model_content shape. The legacy key is
 * removed so the strict payload schema accepts the converted record.
 */
export function normalizeLegacyUserMessagePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!('display_content' in payload) && 'content' in payload) {
    const { content: legacyContent, ...rest } = payload;
    return {
      ...rest,
      display_content: legacyContent,
      model_content: legacyContent,
    };
  }
  return payload;
}

/**
 * Projects legacy assistant content onto the current schema: ToolCall
 * arguments were historically stored as an `argumentsText` JSON string and are
 * read back as the `arguments` object.
 */
export function normalizeLegacyAssistantContent(
  content: readonly SessionAssistantContent[],
): readonly SessionAssistantContent[] {
  return content.map((block) => {
    if (block.type !== 'toolCall' || 'arguments' in block) return block;
    const { argumentsText, ...rest } = block as SessionAssistantContent & {
      argumentsText?: unknown;
      arguments?: unknown;
    };
    if (argumentsText === undefined) return block;
    return { ...rest, arguments: parseLegacyArguments(argumentsText) };
  });
}

function parseLegacyArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { value };
  }
}
