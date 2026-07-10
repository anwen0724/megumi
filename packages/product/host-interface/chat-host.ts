import { RuntimeEventSchema, type RuntimeContext, type RuntimeEvent } from '../../coding-agent/events';

import { TimelineMessageSchema, type TimelineMessage } from '../../coding-agent/projections/timeline';
import { z } from 'zod';

import type { RawUserInputAttachment } from '../../coding-agent/input';

import type {
  AgentRun,
  AgentRunQueries,
  AgentRunService,
  StartRunResult,
} from '../../coding-agent/agent-run';

import type {
  Session,
  SessionBranchService,
  SessionMessageWithAttachments,
  SessionService,
} from '../../coding-agent/session';

import type { CommandService } from '../../coding-agent/commands';
import type {
  ContextUsageWindow,
  GetCurrentContextUsageResult,
  SessionContextUsage,
  StartContextUsageMonitorResult,
} from '../../coding-agent/context';
import type { SessionTimelineQuery } from '../../coding-agent/projections/timeline';
import type { WorkspaceService } from '../../coding-agent/workspace';

/*
 * Implements the ChatHost interface by orchestrating Coding Agent public modules.
 */

export interface ChatHost {
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
  getSessionHydration(request: ChatGetSessionHydrationUiRequest): Promise<ChatGetSessionHydrationUiResult>;
  getContextUsage(request: ChatGetContextUsageUiRequest): Promise<ChatGetContextUsageUiResult>;
}

const IsoDateTimeSchema = z.string().datetime();
export const CommandSuggestionsPayloadSchema = z.object({
  draft_input: z.string(), workspaceId: z.string().min(1).optional(),
}).strict();
export const SessionCreatePayloadSchema = z.object({
  projectId: z.string().min(1), title: z.string().min(1).optional(),
}).strict();
export const SessionListPayloadSchema = z.object({}).strict();
export const SessionMessageListPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const SessionTimelineListPayloadSchema = z.object({
  projectId: z.string().min(1), sessionId: z.string().min(1),
}).strict();
export const SessionHydrationGetPayloadSchema = z.object({
  projectId: z.string().min(1), sessionId: z.string().min(1),
}).strict();
export const SessionContextUsageGetPayloadSchema = z.object({
  sessionId: z.string().min(1), projectId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
  refresh: z.enum(['sync', 'background']).optional(),
}).strict();
export const SessionMessageSendPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(), projectId: z.string().min(1), text: z.string(),
  clientMessageId: z.string().min(1).optional(), createdAt: IsoDateTimeSchema.optional(),
  modelSelection: z.object({ provider_id: z.string().min(1), model_id: z.string().min(1) }).strict(),
  permissionMode: z.enum(['default', 'accept_edits', 'plan', 'auto']).optional(), permissionSource: z.string().optional(),
}).strict();
export const SessionMessageCancelPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
export const SessionBranchDraftCreatePayloadSchema = z.object({
  sessionId: z.string().min(1), messageId: z.string().min(1),
}).strict();
export const SessionBranchDraftCancelPayloadSchema = z.object({
  sessionId: z.string().min(1), branchMarkerId: z.string().min(1),
}).strict();
export const RunListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const RunEventsListPayloadSchema = z.object({ runId: z.string().min(1) }).strict();

const ChatSessionUiDtoSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), title: z.string(),
  status: z.enum(['active', 'archived']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const ChatRunUiDtoSchema = z.object({
  runId: z.string().min(1), sessionId: z.string().min(1), status: z.string().min(1),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
}).strict();
export const ChatSendUserInputUiPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_run'), session: ChatSessionUiDtoSchema, requestId: z.string(), userMessageId: z.string(),
    run: ChatRunUiDtoSchema,
  }).strict(),
  z.object({
    type: z.literal('host_interaction_request'), session: ChatSessionUiDtoSchema.optional(), requestId: z.string(),
    request: z.object({ kind: z.string() }).strict(),
  }).strict(),
  z.object({
    type: z.literal('completed'), session: ChatSessionUiDtoSchema.optional(), requestId: z.string(), message: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('error'), session: ChatSessionUiDtoSchema.optional(), requestId: z.string(), message: z.string(),
  }).strict(),
]);
const HostCommandSuggestionItemSchema = z.object({
  name: z.string(), aliases: z.array(z.string()).optional(), description: z.string(), argument_hint: z.string().optional(),
  source: z.union([
    z.object({ kind: z.literal('built_in') }).strict(),
    z.object({ kind: z.literal('skill'), skill_id: z.string() }).strict(),
  ]),
  source_badge: z.string().optional(),
  display: z.object({ primary: z.string(), secondary: z.string().optional(), badge: z.string().optional() }).strict().optional(),
  match: z.object({ field: z.enum(['name', 'alias']), value: z.string(), prefix: z.string() }).strict(),
  displayInput: z.string(), submitInput: z.string(),
}).strict();

export const ChatCommandSuggestionsUiResultSchema = z.object({
  suggestions: z.discriminatedUnion('type', [
    z.object({ type: z.literal('inactive') }).strict(),
    z.object({
      type: z.literal('suggestions'), draft_input: z.string(), command_prefix: z.string(),
      groups: z.array(z.object({
        id: z.string(), label: z.string(), items: z.array(HostCommandSuggestionItemSchema),
      }).strict()),
    }).strict(),
  ]),
}).strict();
export const ChatCreateSessionUiResultSchema = z.object({ session: ChatSessionUiDtoSchema }).strict();
export const ChatListSessionsUiResultSchema = z.object({ sessions: z.array(ChatSessionUiDtoSchema) }).strict();
export const ChatListMessagesUiResultSchema = z.object({
  messages: z.array(z.object({
    id: z.string().min(1), sessionId: z.string().min(1), runId: z.string().min(1).optional(),
    role: z.enum(['user', 'assistant']), text: z.string(), createdAt: z.string().datetime(),
  }).strict()),
}).strict();
export const ChatListTimelineUiResultSchema = z.object({
  messages: z.array(TimelineMessageSchema),
  diagnostics: z.array(z.object({ messageId: z.string(), code: z.string(), message: z.string() }).strict()).optional(),
}).strict();
export const ChatGetSessionHydrationUiResultSchema = z.object({
  messages: z.array(TimelineMessageSchema),
  diagnostics: z.array(z.object({ messageId: z.string(), code: z.string(), message: z.string() }).strict()).optional(),
  runs: z.array(ChatRunUiDtoSchema),
  runtimeEvents: z.array(RuntimeEventSchema),
}).strict();
export const ChatCancelUserInputUiPayloadSchema = z.object({ cancelled: z.boolean() }).strict();
export const ChatCreateBranchDraftUiPayloadSchema = z.object({
  branchDraft: z.object({
    branchMarkerId: z.string().min(1), sessionId: z.string().min(1), sourceMessageId: z.string().min(1),
    createdAt: z.string().datetime(),
  }).strict(),
}).strict();
export const ChatCancelBranchDraftUiPayloadSchema = z.object({
  cancelled: z.boolean(), reason: z.string().optional(),
}).strict();
export const ChatListRunsUiResultSchema = z.object({ runs: z.array(ChatRunUiDtoSchema) }).strict();
export const ChatListRunEventsUiResultSchema = z.object({ events: z.array(RuntimeEventSchema) }).strict();
export const ChatGetContextUsageUiResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    usage: z.object({
      usedTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative(), remainingTokens: z.number().nonnegative(),
      usedPercent: z.number().nonnegative(), autoCompactPercent: z.number().nonnegative(), shouldAutoCompact: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({ status: z.literal('not_available'), reason: z.enum(['not_started', 'not_calculated']) }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);

export interface SessionBranchHostPort {
  createBranchDraft: SessionBranchService['createBranchDraft'];
  cancelBranchDraft: SessionBranchService['cancelBranchDraft'];
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

export function createChatHost(options: {
  agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'>;
  commandService: Pick<CommandService, 'getCommandSuggestions'>;
  sessionService: SessionService;
  workspaceService: Pick<WorkspaceService, 'listWorkspaces'>;
  branchService: SessionBranchHostPort;
  sessionTimelineQuery: SessionTimelineQuery;
  agentRunQueries: AgentRunQueries;
  contextUsageMonitor?: ChatContextUsageMonitorPort;
  contextUsageWindowProvider?: (request: { sessionId: string; projectId?: string; modelId?: string }) => ContextUsageWindow;
}): ChatHost {
  return {
    async createSession(request) {
      const result = options.sessionService.createSession({
        workspace_id: request.projectId,
        ...(request.title ? { title: request.title } : {}),
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
          : {
              type: 'new',
              ...(request.sessionTitle ? { title: request.sessionTitle } : {}),
            },
        user_input: {
          text: request.text,
          ...(request.attachments ? { attachments: request.attachments } : {}),
        },
        model_selection: request.modelSelection,
        ...(request.permissionMode ? { permission_mode: request.permissionMode } : {}),
      });
      const mapped = mapStartRunResult(result);
      const { events, ...payload } = mapped;
      return {
        payload: payload as ChatSendUserInputUiPayload,
        ...(events ? { events } : {}),
      };
    },

    async cancelUserInput(request) {
      const result = await options.agentRunService.cancelRun({ run_id: request.runId });
      if (result.status === 'cancelled') {
        return { payload: { cancelled: true }, events: asyncIterableFrom(result.events) };
      }
      return { payload: { cancelled: false } };
    },

    createBranchDraft(request) {
      const result = options.branchService.createBranchDraft({
        request_id: request.requestId,
        session_id: request.sessionId,
        source_message_id: request.messageId,
        ...(request.runtimeContext ? { runtime_context: request.runtimeContext } : {}),
      });
      return {
        payload: {
          branchDraft: {
            branchMarkerId: result.branch_draft.branch_marker_id,
            sessionId: result.branch_draft.session_id,
            sourceMessageId: result.branch_draft.source_message_id,
            createdAt: result.branch_draft.created_at,
          },
        },
        events: result.events,
      };
    },

    cancelBranchDraft(request) {
      const result = options.branchService.cancelBranchDraft({
        request_id: request.requestId,
        session_id: request.sessionId,
        branch_marker_id: request.branchMarkerId,
        ...(request.runtimeContext ? { runtime_context: request.runtimeContext } : {}),
      });
      if (result.status === 'cancelled') {
        return { payload: { cancelled: true }, events: result.events };
      }
      return { payload: { cancelled: false, reason: result.reason } };
    },

    async getCommandSuggestions(request) {
      return { suggestions: toHostCommandSuggestions(await options.commandService.getCommandSuggestions(request)) };
    },

    async listRuns(request) {
      return { runs: options.agentRunQueries.listRunsBySession(request.sessionId).map(toChatRunUiDto) };
    },

    async listRunEvents(request) {
      return { events: options.agentRunQueries.listRuntimeEventsByRun(request.runId) };
    },

    async getSessionHydration(request) {
      const timeline = options.sessionTimelineQuery.listSessionTimeline({
        workspace_id: request.projectId,
        session_id: request.sessionId,
      });
      const runs = options.agentRunQueries.listRunsBySession(request.sessionId);
      return {
        messages: timeline.messages,
        diagnostics: timeline.diagnostics,
        runs: runs.map(toChatRunUiDto),
        runtimeEvents: runs.flatMap((run) => options.agentRunQueries.listRuntimeEventsByRun(run.run_id)),
      };
    },

    async getContextUsage(request) {
      if (!options.contextUsageMonitor || !options.contextUsageWindowProvider) {
        return { status: 'not_available', reason: 'not_started' };
      }

      const monitorRequest = {
        session_id: request.sessionId,
        ...(request.projectId ? { workspace_id: request.projectId } : {}),
        model_config: options.contextUsageWindowProvider(request),
      };
      const usageRequest = {
        session_id: request.sessionId,
        ...(request.projectId ? { workspace_id: request.projectId } : {}),
      };
      const refreshRequest = {
        ...usageRequest,
        reason: 'ui_context_usage_requested',
      };

      if (request.refresh === 'background') {
        void Promise.resolve(options.contextUsageMonitor.start(monitorRequest))
          .then((startResult) => {
            if (startResult.status === 'failed') return undefined;
            return options.contextUsageMonitor!.refreshSession(refreshRequest);
          })
          .catch(() => undefined);

        return mapBackgroundContextUsage(options.contextUsageMonitor.getCurrentUsage(usageRequest));
      }

      const startResult = await options.contextUsageMonitor.start(monitorRequest);
      if (startResult.status === 'failed') {
        return { status: 'failed', message: startResult.failure.message };
      }

      await options.contextUsageMonitor.refreshSession(refreshRequest);

      return mapCurrentContextUsage(options.contextUsageMonitor.getCurrentUsage(usageRequest));
    },
  };
}

function mapCurrentContextUsage(current: GetCurrentContextUsageResult): ChatGetContextUsageUiResult {
  if (current.status === 'ok') {
    return { status: 'ok', usage: toChatContextUsageUiDto(current.usage) };
  }
  if (current.status === 'failed') {
    return { status: 'failed', message: current.failure.message };
  }
  return current;
}

function mapBackgroundContextUsage(current: GetCurrentContextUsageResult): ChatGetContextUsageUiResult {
  const mapped = mapCurrentContextUsage(current);
  if (mapped.status === 'not_available' && mapped.reason === 'not_started') {
    return { status: 'not_available', reason: 'not_calculated' };
  }
  return mapped;
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
): ChatSendUserInputUiPayload & { events?: AsyncIterable<import('../../coding-agent/events').RuntimeEvent> } {
  if (result.status === 'started') {
    return {
      type: 'agent_run',
      session: toChatSessionUiDto(result.session),
      requestId: result.request_id,
      userMessageId: result.user_message_id,
      run: toChatRunUiDto(result.run),
      events: result.events,
    };
  }

  if (result.status === 'host_interaction_required') {
    return {
      type: 'host_interaction_request',
      ...(result.session ? { session: toChatSessionUiDto(result.session) } : {}),
      requestId: result.request_id,
      request: result.interaction,
    };
  }

  if (result.status === 'completed') {
    return {
      type: 'completed',
      ...(result.session ? { session: toChatSessionUiDto(result.session) } : {}),
      requestId: result.request_id,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  return {
    type: 'error',
    ...(result.session ? { session: toChatSessionUiDto(result.session) } : {}),
    requestId: result.request_id,
    message: result.failure.message,
  };
}

async function* asyncIterableFrom<T>(items: Iterable<T>): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function toHostCommandSuggestions(
  result: Awaited<ReturnType<CommandService['getCommandSuggestions']>>,
): HostCommandSuggestionResult {
  if (result.type === 'inactive') return result;
  return {
    ...result,
    groups: result.groups.map((group) => ({
      ...group,
      items: group.items.map(({ completion, ...item }) => ({
        ...item,
        displayInput: `/${item.display?.primary ?? item.name} `,
        submitInput: completion.replacement_input,
      })),
    })),
  };
}

/*
 * Chat/session UI DTOs exposed to hosts. These are projections of product data,
 * not session module service contracts.
 */



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

export interface ChatGetSessionHydrationUiRequest {
  projectId: string;
  sessionId: string;
}

export interface ChatGetSessionHydrationUiResult {
  messages: TimelineMessage[];
  diagnostics?: Array<{ messageId: string; code: string; message: string }>;
  runs: ChatRunUiDto[];
  runtimeEvents: RuntimeEvent[];
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
  runtimeContext?: RuntimeContext;
}
export interface ChatCreateBranchDraftUiResult {
  payload: { branchDraft: {
    branchMarkerId: string;
    sessionId: string;
    sourceMessageId: string;
    createdAt: string;
  } };
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ChatCancelBranchDraftUiRequest {
  requestId: string;
  sessionId: string;
  branchMarkerId: string;
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
  refresh?: 'sync' | 'background';
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

/*
 * Maps session and agent-run facts into host-facing chat UI DTOs.
 */



export function toChatSessionUiDto(session: Session): ChatSessionUiDto {
  return {
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}
export function toChatMessageUiDto(item: SessionMessageWithAttachments): ChatSessionMessageUiDto {
  const { message } = item;
  return {
    id: message.message_id,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    role: message.role,
    text: message.content_text,
    createdAt: message.created_at,
  };
}

export function toChatRunUiDto(run: AgentRun): ChatRunUiDto {
  return {
    runId: run.run_id,
    sessionId: run.session_id,
    status: run.status,
    createdAt: run.created_at,
    ...(run.completed_at ? { completedAt: run.completed_at } : {}),
  };
}
