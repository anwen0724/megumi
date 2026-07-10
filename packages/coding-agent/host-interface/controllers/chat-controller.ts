/*
 * Host chat controller. It maps UI chat requests to Coding Agent services and returns UI DTOs.
 */
import type { AgentRunQueries, AgentRunService, StartRunResult } from '../../agent-run';
import type { CommandService } from '../../commands';
import type {
  ContextUsageWindow,
  GetCurrentContextUsageResult,
  SessionContextUsage,
  StartContextUsageMonitorResult,
} from '../../context';
import type { Session, SessionMessageWithAttachments, SessionService } from '../../session';
import type { SessionTimelineQuery } from '../../projections/timeline';
import type { WorkspaceService } from '../../workspace';
import {
  toChatMessageUiDto,
  toChatRunUiDto,
  toChatSessionUiDto,
} from '../mappers/chat-ui-mapper';
import type {
  ChatCancelBranchDraftUiRequest,
  ChatCancelBranchDraftUiResult,
  ChatCancelUserInputUiRequest,
  ChatCancelUserInputUiResult,
  ChatCreateBranchDraftUiRequest,
  ChatCreateBranchDraftUiResult,
  ChatCreateSessionUiRequest,
  ChatCreateSessionUiResult,
  ChatGetCommandSuggestionsUiRequest,
  ChatGetCommandSuggestionsUiResult,
  ChatGetContextUsageUiRequest,
  ChatGetContextUsageUiResult,
  ChatListMessagesUiRequest,
  ChatListMessagesUiResult,
  ChatListRunEventsUiRequest,
  ChatListRunEventsUiResult,
  ChatListRunsUiRequest,
  ChatListRunsUiResult,
  ChatListSessionsUiRequest,
  ChatListSessionsUiResult,
  ChatListTimelineUiRequest,
  ChatListTimelineUiResult,
  ChatSendUserInputUiRequest,
  ChatSendUserInputUiResult,
} from '../contracts/chat-ui-contracts';

export interface ChatController {
  createSession(request: ChatCreateSessionUiRequest): Promise<ChatCreateSessionUiResult>;
  listSessions(request?: ChatListSessionsUiRequest): Promise<ChatListSessionsUiResult>;
  listMessages(request: ChatListMessagesUiRequest): Promise<ChatListMessagesUiResult>;
  listTimeline(request: ChatListTimelineUiRequest): Promise<ChatListTimelineUiResult>;
  sendUserInput(request: ChatSendUserInputUiRequest): Promise<ChatSendUserInputUiResult>;
  cancelUserInput(request: ChatCancelUserInputUiRequest): Promise<ChatCancelUserInputUiResult>;
  createBranchDraft(request: ChatCreateBranchDraftUiRequest): ChatCreateBranchDraftUiResult;
  cancelBranchDraft(request: ChatCancelBranchDraftUiRequest): ChatCancelBranchDraftUiResult;
  getCommandSuggestions(request: ChatGetCommandSuggestionsUiRequest): Promise<ChatGetCommandSuggestionsUiResult>;
  listRuns(request: ChatListRunsUiRequest): Promise<ChatListRunsUiResult>;
  listRunEvents(request: ChatListRunEventsUiRequest): Promise<ChatListRunEventsUiResult>;
  getContextUsage(request: ChatGetContextUsageUiRequest): Promise<ChatGetContextUsageUiResult>;
}

export interface SessionBranchControllerServicePort {
  createBranchDraft(input: ChatCreateBranchDraftUiRequest): ChatCreateBranchDraftUiResult;
  cancelBranchDraft(input: ChatCancelBranchDraftUiRequest): ChatCancelBranchDraftUiResult;
}

export interface ChatContextUsageMonitorPort {
  getCurrentUsage(request: { session_id: string; workspace_id?: string }): GetCurrentContextUsageResult;
  start(request: {
    session_id: string;
    workspace_id?: string;
    model_config: ContextUsageWindow;
  }): Promise<StartContextUsageMonitorResult> | StartContextUsageMonitorResult;
  refreshSession(request: { session_id: string; workspace_id?: string; reason: string }): Promise<void> | void;
}

export function createChatController(options: {
  agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'>;
  commandService: Pick<CommandService, 'getCommandSuggestions'>;
  sessionService: SessionService;
  workspaceService: Pick<WorkspaceService, 'listWorkspaces'>;
  branchService: SessionBranchControllerServicePort;
  sessionTimelineQuery: SessionTimelineQuery;
  agentRunQueries: AgentRunQueries;
  contextUsageMonitor?: ChatContextUsageMonitorPort;
  contextUsageWindowProvider?: (request: { sessionId: string; projectId?: string; modelId?: string }) => ContextUsageWindow;
}): ChatController {
  return {
    async createSession(request) {
      const result = options.sessionService.createSession({
        session_id: `session:${crypto.randomUUID()}`,
        workspace_id: request.projectId,
        title: request.title ?? 'New Chat',
        created_at: new Date().toISOString(),
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { session: toChatSessionUiDto(result.session) };
    },

    async listSessions() {
      const sessions: Session[] = [];
      const workspaces = await options.workspaceService.listWorkspaces();
      for (const workspace of workspaces.workspaces) {
        const result = options.sessionService.listSessions({ workspace_id: workspace.workspace_id });
        if (result.status === 'failed') {
          throw new Error(result.failure.message);
        }
        sessions.push(...result.sessions);
      }
      return { sessions: sessions.map(toChatSessionUiDto) };
    },

    async listMessages(request) {
      const result = options.sessionService.listMessages({
        session_id: request.sessionId,
        active_path_only: true,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { messages: result.messages.map(toChatMessageUiDto) };
    },

    async listTimeline(request) {
      return options.sessionTimelineQuery.listSessionTimeline({
        workspace_id: request.projectId,
        session_id: request.sessionId,
      });
    },

    async sendUserInput(request) {
      const requestId = request.requestId ?? `request:${crypto.randomUUID()}`;
      const result = await options.agentRunService.startRun({
        request_id: requestId,
        workspace_id: request.projectId,
        session: request.sessionId
          ? { type: 'existing', session_id: request.sessionId }
          : { type: 'new', ...(request.sessionTitle ? { title: request.sessionTitle } : {}) },
        user_input: {
          text: request.text,
          ...(request.attachments ? { attachments: request.attachments } : {}),
        },
        model_selection: request.modelSelection,
        permission_mode: request.permissionMode,
      });
      const mapped = mapStartRunResult(result, options.sessionService, request);
      return mapped;
    },

    async cancelUserInput(request) {
      const result = await options.agentRunService.cancelRun({ run_id: request.runId });
      if (result.status === 'cancelled') {
        return { cancelled: true, events: asyncIterableFrom(result.events) };
      }
      return { cancelled: false };
    },

    createBranchDraft(request) {
      return options.branchService.createBranchDraft(request);
    },

    cancelBranchDraft(request) {
      return options.branchService.cancelBranchDraft(request);
    },

    async getCommandSuggestions(request) {
      return { suggestions: await options.commandService.getCommandSuggestions(request) };
    },

    async listRuns(request) {
      return { runs: options.agentRunQueries.listRunsBySession(request.sessionId).map(toChatRunUiDto) };
    },

    async listRunEvents(request) {
      return { events: options.agentRunQueries.listRuntimeEventsByRun(request.runId) };
    },

    async getContextUsage(request) {
      if (!options.contextUsageMonitor || !options.contextUsageWindowProvider) {
        return { status: 'not_available', reason: 'not_started' };
      }

      const startResult = await options.contextUsageMonitor.start({
        session_id: request.sessionId,
        ...(request.projectId ? { workspace_id: request.projectId } : {}),
        model_config: options.contextUsageWindowProvider(request),
      });
      if (startResult.status === 'failed') {
        return { status: 'failed', message: startResult.failure.message };
      }

      await options.contextUsageMonitor.refreshSession({
        session_id: request.sessionId,
        ...(request.projectId ? { workspace_id: request.projectId } : {}),
        reason: 'ui_context_usage_requested',
      });

      const refreshed = options.contextUsageMonitor.getCurrentUsage({
        session_id: request.sessionId,
        ...(request.projectId ? { workspace_id: request.projectId } : {}),
      });
      if (refreshed.status === 'ok') {
        return { status: 'ok', usage: toChatContextUsageUiDto(refreshed.usage) };
      }
      if (refreshed.status === 'failed') {
        return { status: 'failed', message: refreshed.failure.message };
      }
      return refreshed;
    },
  };
}

function toChatContextUsageUiDto(usage: SessionContextUsage) {
  return {
    usedTokens: usage.used_tokens,
    totalTokens: usage.context_window_tokens,
    remainingTokens: usage.remaining_tokens,
    usedPercent: Math.round(usage.used_ratio * 100),
    autoCompactPercent: Math.round(usage.auto_compaction_threshold_ratio * 100),
    shouldAutoCompact: usage.should_auto_compact,
  };
}

function mapStartRunResult(
  result: StartRunResult,
  sessionService: SessionService,
  input: ChatSendUserInputUiRequest,
): ChatSendUserInputUiResult {
  if (result.status === 'started') {
    return {
      type: 'agent_run',
      session: getSessionOrFallback(sessionService, result.session_id, input),
      requestId: result.request_id,
      userMessageId: result.user_message_id,
      run: toChatRunUiDto(result.run),
      events: result.events,
    };
  }

  if (result.status === 'host_interaction_required') {
    return {
      type: 'host_interaction_request',
      ...(result.session_id ? { session: getSessionOrFallback(sessionService, result.session_id, input) } : {}),
      requestId: result.request_id,
      request: result.interaction,
    };
  }

  if (result.status === 'completed') {
    return {
      type: 'completed',
      ...(result.session_id ? { session: getSessionOrFallback(sessionService, result.session_id, input) } : {}),
      requestId: result.request_id,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  return {
    type: 'error',
    ...(result.session_id ? { session: getSessionOrFallback(sessionService, result.session_id, input) } : {}),
    requestId: result.request_id,
    message: result.failure.message,
  };
}

function getSessionOrFallback(
  sessionService: SessionService,
  sessionId: string,
  input: ChatSendUserInputUiRequest,
) {
  const result = sessionService.getSession({ session_id: sessionId });
  if (result.status === 'found') {
    return toChatSessionUiDto(result.session);
  }
  return toChatSessionUiDto({
    session_id: sessionId,
    workspace_id: input.projectId,
    title: input.sessionTitle ?? 'Session',
    status: 'active',
    created_at: input.createdAt ?? new Date().toISOString(),
    updated_at: input.createdAt ?? new Date().toISOString(),
  });
}

async function* asyncIterableFrom<T>(items: Iterable<T>): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}
