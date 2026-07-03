/*
 * Defines the stable Input module contracts for normalizing and classifying
 * submitted user input before later orchestration decides what to run.
 */

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

export type ProcessUserInputRequest = {
  user_input: RawUserInput;
};

export type ProcessUserInputResult =
  | { status: 'ok'; parsed_user_input: ParsedUserInput }
  | { status: 'failed'; failure: InputFailure };

export type InputFailure = {
  code: 'input_processing_failed';
  message: string;
  details?: Record<string, unknown>;
};

export type InputService = {
  processUserInput(request: ProcessUserInputRequest): Promise<ProcessUserInputResult>;
};
