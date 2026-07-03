/*
 * Provides the public Input Service by composing text normalization and user
 * input classification. It intentionally does not call Command Service.
 */
import type {
  InputService,
  ProcessUserInputRequest,
  ProcessUserInputResult,
} from '../contracts/input-contracts';
import { normalizeRawInputText } from '../core/raw-input-normalizer';
import { parseUserInput } from '../core/user-input-parser';

export function createInputService(): InputService {
  return {
    async processUserInput(request: ProcessUserInputRequest): Promise<ProcessUserInputResult> {
      try {
        const normalized_text = normalizeRawInputText(request.user_input.text);
        return {
          status: 'ok',
          parsed_user_input: parseUserInput({
            normalized_text,
            attachments: request.user_input.attachments ?? [],
          }),
        };
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: 'input_processing_failed',
            message: error instanceof Error ? error.message : 'Input processing failed.',
          },
        };
      }
    },
  };
}
