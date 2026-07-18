/*
 * Classifies normalized submitted user input without parsing or executing
 * command semantics owned by the Command module.
 */
import type { ParsedUserInput } from '../../domain/model/user-input';
import type { ProcessedInputImage } from '../../domain/model/image-input';

export type ParseUserInputRequest = {
  normalized_text: string;
  attachments: ProcessedInputImage[];
};

export function parseUserInput(request: ParseUserInputRequest): ParsedUserInput {
  const type = isCommandShapedInput(request.normalized_text) ? 'command' : 'message';
  if (type === 'command') return { type, text: request.normalized_text, attachments: [] };
  return {
    type,
    text: request.normalized_text,
    attachments: request.attachments,
  };
}

function isCommandShapedInput(text: string): boolean {
  if (!text.startsWith('/')) {
    return false;
  }

  return text.slice(1).trim().length > 0;
}
