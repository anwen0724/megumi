/*
 * Provides the public Input Service by composing text normalization and user
 * input classification. It intentionally does not call Command Service.
 */
import type {
  ProcessUserInputRequest,
  ProcessUserInputResult,
} from '../domain/dto/agent-run/input-agent-run-request';
import type { InputService } from './input-service';
import type { InputServiceDependencies } from './input-service-types';
import { normalizeRawInputText } from './internal/raw-input-normalizer';
import { parseUserInput } from './internal/user-input-classifier';
import { processInputImages } from './internal/image-input-processor';
import { processInputDocuments } from './internal/document-input-processor';

export function createInputService(dependencies: InputServiceDependencies): InputService {
  return {
    async processUserInput(request: ProcessUserInputRequest): Promise<ProcessUserInputResult> {
      try {
        const normalized_text = normalizeRawInputText(request.user_input.text);
        const attachments = request.user_input.attachments ?? [];
        const images = await processInputImages({
          images: attachments.filter((attachment) => attachment.type === 'image'),
          fileReader: dependencies.fileReader,
        });
        if (images.status === 'failed') return images;
        const documents = await processInputDocuments({
          documents: attachments.filter((attachment) => attachment.type === 'file'),
          fileReader: dependencies.fileReader,
        });
        if (documents.status === 'failed') return documents;
        const processedAttachments = [...images.images, ...documents.documents];
        if (!normalized_text && processedAttachments.length === 0) {
          return { status: 'failed', failure: { code: 'input_empty', message: 'Enter a message or select a file.' } };
        }
        if (normalized_text.startsWith('/') && normalized_text.slice(1).trim() && processedAttachments.length > 0) {
          return { status: 'failed', failure: { code: 'command_attachment_unsupported', message: 'Commands do not support attachments.' } };
        }
        return {
          status: 'ok',
          parsed_user_input: parseUserInput({
            normalized_text,
            attachments: processedAttachments,
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
