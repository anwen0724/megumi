/* Defines Session write results returned to Agent Run. */
import type { SessionEntry } from '../../model/session-entry';
import type { SessionMessage, SessionMessageWithAttachments } from '../../model/session-message';
import type { SessionRuntimeError } from '../../model/session';

export type SaveUserMessageResult =
  | { status: 'saved'; message: SessionMessageWithAttachments; entry: SessionEntry }
  | { status: 'failed'; failure: SessionRuntimeError };

export type SaveModelResponseResult =
  | { status: 'saved'; message: SessionMessage; entry: SessionEntry }
  | { status: 'failed'; failure: SessionRuntimeError };

export type SaveAssistantReplyResult =
  | { status: 'saved'; message: SessionMessage; entry: SessionEntry }
  | { status: 'failed'; failure: SessionRuntimeError };

export type SaveToolResultMessageResult =
  | { status: 'saved'; message: SessionMessage; entry: SessionEntry }
  | { status: 'failed'; failure: SessionRuntimeError };
