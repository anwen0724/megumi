/* Defines raw and processed user-input facts owned by the Input module. */

export type RawUserInput = {
  text: string;
  attachments?: RawUserInputAttachment[];
};

import type { ProcessedInputDocument, RawUserInputDocument } from './document-input';
import type { ProcessedInputImage, RawUserInputImage } from './image-input';

export type RawUserInputAttachment = RawUserInputImage | RawUserInputDocument;
export type ProcessedInputAttachment = ProcessedInputImage | ProcessedInputDocument;

export type ParsedUserInput =
  | {
      type: 'message';
      text: string;
      attachments: ProcessedInputAttachment[];
    }
  | {
      type: 'command';
      text: string;
      attachments: [];
    };

export type InputFailure = {
  code:
    | 'input_processing_failed'
    | 'input_empty'
    | 'image_count_exceeded'
    | 'image_too_large'
    | 'image_total_size_exceeded'
    | 'image_format_unsupported'
    | 'image_mime_mismatch'
    | 'image_read_failed'
    | 'document_count_exceeded'
    | 'document_too_large'
    | 'document_format_unsupported'
    | 'document_mime_mismatch'
    | 'document_reference_unavailable'
    | 'command_attachment_unsupported';
  message: string;
  details?: Record<string, unknown>;
};
