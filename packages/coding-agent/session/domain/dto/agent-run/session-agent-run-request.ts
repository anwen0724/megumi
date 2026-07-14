/* Defines Session write requests used by Agent Run. */
import type { AssistantContentBlock, ContentBlock } from '@megumi/ai';
import type { SessionMessageAttachmentInput } from '../../model/session-attachment';

export type SaveUserMessageRequest = {
  message_id: string;
  session_id: string;
  run_id?: string;
  content: ContentBlock[];
  attachments?: SessionMessageAttachmentInput[];
  parent_entry_id?: string;
  created_at: string;
};

export type SaveAssistantMessageRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  parent_entry_id?: string;
  content: AssistantContentBlock[];
  stop_reason?: string;
  completed_at: string;
};

export type SaveToolResultMessageRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  parent_entry_id?: string;
  tool_call_id: string;
  tool_name: string;
  status: 'success' | 'failure';
  content: ContentBlock[];
  completed_at: string;
};
