/*
 * Host chat controller. It maps UI chat requests to Coding Agent services and returns UI DTOs.
 */
import type { AgentRun, AgentRunService, StartRunResult } from '../../agent-run';
import type { CommandService } from '../../commands';
import type { Session, SessionMessageWithAttachments, SessionService } from '../../session';
import {
  mapAgentRunEvents,
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
}

export interface ChatControllerCompatibilityQueries {
  listWorkspaceIds(): string[];
  listTimelineMessagesBySession(payload: ChatListTimelineUiRequest): ChatListTimelineUiResult;
  listRunsBySession(sessionId: string): AgentRun[];
  listRuntimeEventsByRun?(runId: string): ChatListRunEventsUiResult['events'];
}

export interface SessionBranchControllerServicePort {
  createBranchDraft(input: ChatCreateBranchDraftUiRequest): ChatCreateBranchDraftUiResult;
  cancelBranchDraft(input: ChatCancelBranchDraftUiRequest): ChatCancelBranchDraftUiResult;
}

export function createChatController(options: {
  agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'>;
  commandService: Pick<CommandService, 'getCommandSuggestions'>;
  sessionService: SessionService;
  branchService: SessionBranchControllerServicePort;
  compatibility: ChatControllerCompatibilityQueries;
}): ChatController {
  const runIdByRequestId = new Map<string, string>();

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
      for (const workspaceId of options.compatibility.listWorkspaceIds()) {
        const result = options.sessionService.listSessions({ workspace_id: workspaceId });
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
      return options.compatibility.listTimelineMessagesBySession(request);
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
      if (mapped.type === 'agent_run') {
        runIdByRequestId.set(mapped.requestId, mapped.run.runId);
      }
      return mapped;
    },

    async cancelUserInput(request) {
      const runId = runIdByRequestId.get(request.targetRequestId) ?? request.targetRequestId;
      const result = await options.agentRunService.cancelRun({ run_id: runId });
      if (result.status === 'cancelled') {
        return { cancelled: true, events: mapAgentRunEvents(asyncIterableFrom(result.events), request.targetRequestId) };
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
      return { suggestions: options.commandService.getCommandSuggestions(request) };
    },

    async listRuns(request) {
      return { runs: options.compatibility.listRunsBySession(request.sessionId).map(toChatRunUiDto) };
    },

    async listRunEvents(request) {
      return { events: options.compatibility.listRuntimeEventsByRun?.(request.runId) ?? [] };
    },
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
      events: mapAgentRunEvents(result.events, result.request_id),
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
