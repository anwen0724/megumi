/*
 * Classifies normalized submitted user input without parsing or executing
 * command semantics owned by the Command module.
 */
import type {
  ParsedUserInput,
  RawUserInputAttachment,
} from '../contracts/input-contracts';

export type ParseUserInputRequest = {
  normalized_text: string;
  attachments: RawUserInputAttachment[];
};

export function parseUserInput(request: ParseUserInputRequest): ParsedUserInput {
  const type = isCommandShapedInput(request.normalized_text) ? 'command' : 'message';
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
