/*
 * Chat/session UI DTOs exposed to hosts. These are projections of product data,
 * not session module service contracts.
 */
import type { RuntimeContext, RuntimeEvent } from '../../coding-agent/events';
import type { TimelineMessage } from '../../coding-agent/projections/timeline';
import type { RawUserInputAttachment } from '../../coding-agent/input';

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
  permissionMode?: 'default' | 'accept_edits' | 'plan' | 'auto';
  permissionSource?: string;
  runtimeContext?: RuntimeContext;
}
export type ChatSendUserInputUiPayload =
  | {
      type: 'agent_run';
      session: ChatSessionUiDto;
      requestId: string;
      userMessageId: string;
      run: ChatRunUiDto;
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
export interface ChatSendUserInputUiResult {
  payload: ChatSendUserInputUiPayload;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ChatCancelUserInputUiRequest {
  runId: string;
}
export interface ChatCancelUserInputUiResult {
  payload: { cancelled: boolean };
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
  payload: { branchDraft: {
    branchMarkerId: string;
    sessionId: string;
    sourceMessageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
  } };
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ChatCancelBranchDraftUiRequest {
  requestId: string;
  sessionId: string;
  branchMarkerId: string;
  createdAt: string;
  runtimeContext?: RuntimeContext;
}
export interface ChatCancelBranchDraftUiResult {
  payload: {
    cancelled: boolean;
    reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found' | string;
  };
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ChatGetCommandSuggestionsUiRequest {
  draft_input: string;
  workspaceId?: string;
}
export interface ChatGetCommandSuggestionsUiResult {
  suggestions: HostCommandSuggestionResult;
}

export type HostCommandSuggestionResult =
  | { type: 'inactive' }
  | {
      type: 'suggestions';
      draft_input: string;
      command_prefix: string;
      groups: Array<{ id: string; label: string; items: HostCommandSuggestionItem[] }>;
    };

export type HostCommandSuggestionItem = {
  name: string;
  aliases?: string[];
  description: string;
  argument_hint?: string;
  source: { kind: 'built_in' } | { kind: 'skill'; skill_id: string };
  source_badge?: string;
  display?: { primary: string; secondary?: string; badge?: string };
  match: { field: 'name' | 'alias'; value: string; prefix: string };
  displayInput: string;
  submitInput: string;
};
export type CommandSuggestionItem = HostCommandSuggestionItem;
export type CommandSuggestionResult = HostCommandSuggestionResult;

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

export interface ChatGetContextUsageUiRequest {
  sessionId: string;
  projectId?: string;
  modelId?: string;
}

export type ChatContextUsageUiDto = {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedPercent: number;
  autoCompactPercent: number;
  shouldAutoCompact: boolean;
};

export type ChatGetContextUsageUiResult =
  | { status: 'ok'; usage: ChatContextUsageUiDto }
  | { status: 'not_available'; reason: 'not_started' | 'not_calculated' }
  | { status: 'failed'; message: string };
