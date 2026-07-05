/*
 * Chat/session UI DTOs exposed to hosts. These are projections of product data,
 * not session module service contracts.
 */
import type { CommandSuggestionResult } from '../../commands';
import type { RuntimeContext, RuntimeEvent } from '../../events';
import type { TimelineMessage } from '../../projections/timeline';
import type { RawUserInputAttachment } from '../../input';

export interface ChatSessionUiDto {
  id: string;
  projectId: string;
  title: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionMessageUiDto {
  id: string;
  sessionId: string;
  runId?: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface ChatRunUiDto {
  runId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled' | string;
  createdAt: string;
  completedAt?: string;
}

export interface ChatCreateSessionUiRequest {
  projectId: string;
  title?: string;
}
export interface ChatCreateSessionUiResult {
  session: ChatSessionUiDto;
}

export interface ChatListSessionsUiRequest {}
export interface ChatListSessionsUiResult {
  sessions: ChatSessionUiDto[];
}

export interface ChatListMessagesUiRequest {
  sessionId: string;
}
export interface ChatListMessagesUiResult {
  messages: ChatSessionMessageUiDto[];
}

export interface ChatListTimelineUiRequest {
  projectId: string;
  sessionId: string;
}
export interface ChatListTimelineUiResult {
  messages: TimelineMessage[];
  diagnostics?: Array<{ messageId: string; code: string; message: string }>;
}

export interface ChatSendUserInputUiRequest {
  requestId?: string;
  sessionId?: string;
  sessionTitle?: string;
  projectId: string;
  projectLabel?: string;
  projectPath?: string;
  text: string;
  attachments?: RawUserInputAttachment[];
  clientMessageId?: string;
  createdAt?: string;
  modelSelection: {
    provider_id: string;
    model_id: string;
  };
  permissionMode: 'default' | 'plan' | 'auto';
  permissionSource?: string;
  runtimeContext?: RuntimeContext;
}
export type ChatSendUserInputUiResult =
  | {
      type: 'agent_run';
      session: ChatSessionUiDto;
      requestId: string;
      userMessageId: string;
      run: ChatRunUiDto;
      events: AsyncIterable<RuntimeEvent>;
    }
  | {
      type: 'host_interaction_request';
      session?: ChatSessionUiDto;
      requestId: string;
      request: { kind: string };
    }
  | {
      type: 'completed';
      session?: ChatSessionUiDto;
      requestId: string;
      message?: string;
    }
  | {
      type: 'error';
      session?: ChatSessionUiDto;
      requestId: string;
      message: string;
    };

export interface ChatCancelUserInputUiRequest {
  targetRequestId: string;
}
export interface ChatCancelUserInputUiResult {
  cancelled: boolean;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ChatCreateBranchDraftUiRequest {
  requestId: string;
  sessionId: string;
  messageId: string;
  intent: 'branch' | 'rerun';
  createdAt: string;
  runtimeContext?: RuntimeContext;
}
export interface ChatCreateBranchDraftUiResult {
  branchDraft: {
    branchMarkerId: string;
    sessionId: string;
    sourceMessageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
  };
  events: Iterable<RuntimeEvent>;
}

export interface ChatCancelBranchDraftUiRequest {
  requestId: string;
  sessionId: string;
  branchMarkerId: string;
  createdAt: string;
  runtimeContext?: RuntimeContext;
}
export interface ChatCancelBranchDraftUiResult {
  cancelled: boolean;
  reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found' | string;
  events: Iterable<RuntimeEvent>;
}

export interface ChatGetCommandSuggestionsUiRequest {
  draft_input: string;
}
export interface ChatGetCommandSuggestionsUiResult {
  suggestions: CommandSuggestionResult;
}

export interface ChatListRunsUiRequest {
  sessionId: string;
}
export interface ChatListRunsUiResult {
  runs: ChatRunUiDto[];
}

export interface ChatListRunEventsUiRequest {
  runId: string;
}
export interface ChatListRunEventsUiResult {
  events: RuntimeEvent[];
}
