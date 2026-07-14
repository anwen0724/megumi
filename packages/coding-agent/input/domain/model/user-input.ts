/* Defines raw and processed user-input facts owned by the Input module. */

export type RawUserInput = {
  text: string;
  attachments?: RawUserInputAttachment[];
};

import type { ProcessedInputImage, RawUserInputImage } from './image-input';

export type RawUserInputAttachment = RawUserInputImage;

export type ParsedUserInput =
  | {
      type: 'message';
      text: string;
      attachments: ProcessedInputImage[];
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
    | 'command_image_unsupported';
  message: string;
  details?: Record<string, unknown>;
};
