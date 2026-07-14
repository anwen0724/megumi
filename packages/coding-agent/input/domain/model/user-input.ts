/* Defines raw and processed user-input facts owned by the Input module. */

export type RawUserInput = {
  text: string;
  attachments?: RawUserInputAttachment[];
};

export type RawUserInputAttachment = {
  attachment_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source:
    | { type: 'local_file'; path: string }
    | { type: 'host_reference'; reference_id: string };
};

export type ParsedUserInput =
  | {
      type: 'message';
      text: string;
      attachments: RawUserInputAttachment[];
    }
  | {
      type: 'command';
      text: string;
      attachments: RawUserInputAttachment[];
    };

export type InputFailure = {
  code: 'input_processing_failed';
  message: string;
  details?: Record<string, unknown>;
};
