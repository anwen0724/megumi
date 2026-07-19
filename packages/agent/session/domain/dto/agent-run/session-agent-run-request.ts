/* Defines Session write requests used by Agent Run. */
import type { AssistantContentBlock, ContentBlock } from '@megumi/ai';
import type { AssistantReplyReasonCode, AssistantReplyStatus } from '../../model/session-message';
import type { SessionImageImport } from '../../model/session-attachment';

export type SaveUserMessageRequest = {
  message_id: string;
  session_id: string;
  run_id?: string;
  content: ContentBlock[];
  attachments?: SessionImageImport[];
  parent_entry_id?: string;
  created_at: string;
};

export type SaveModelResponseRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  parent_entry_id?: string;
  content: AssistantContentBlock[];
  outcome_status: 'completed' | 'incomplete' | 'failed';
  reason_code?: string;
  stop_reason?: string;
  completed_at: string;
};

export type SaveAssistantReplyRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  parent_entry_id?: string;
  status: AssistantReplyStatus;
  content: AssistantContentBlock[];
  reason_code?: AssistantReplyReasonCode;
  completed_at: string;
};

export type SaveToolResultMessageRequest = {
  message_id: string;
  session_id: string;
  run_id: string;
  parent_entry_id?: string;
  tool_call_id: string;
  tool_name: string;
  status: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  error?: { code: string; message: string; details?: Record<string, unknown> };
  content: ContentBlock[];
  completed_at: string;
};
