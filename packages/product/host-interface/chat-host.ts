import { RuntimeEventSchema, type RuntimeContext, type RuntimeEvent } from '../../coding-agent/events';

import { TimelineMessageSchema, type TimelineMessage } from '../../coding-agent/projections/timeline';
import { z } from 'zod';
import { encodeBase64 } from '@megumi/ai';

import { IMAGE_INPUT_POLICY } from '../../coding-agent/input';

import type {
  AgentRun,
  AgentRunService,
  StartRunResult,
} from '../../coding-agent/agent-run';

import {
  sessionConversationText,
  type Session,
  type SessionBranchService,
  type SessionMessageWithAttachments,
  type SessionService,
} from '../../coding-agent/session';

import type { CommandService } from '../../coding-agent/commands';
import type { ContextService, GetSessionUsageSnapshotResult } from '../../coding-agent/context';
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
  getInputCapabilities(): ChatImageInputCapabilitiesUiResult;
  selectImages(): Promise<ChatSelectImagesUiResult>;
  readAttachmentImage(request: ChatReadAttachmentImageUiRequest): Promise<ChatReadAttachmentImageUiResult>;
}

const IsoDateTimeSchema = z.string().datetime();
export const CommandSuggestionsPayloadSchema = z.object({
  draft_input: z.string(), workspaceId: z.string().min(1).optional(),
}).strict();
export const SessionCreatePayloadSchema = z.object({
  projectId: z.string().min(1), title: z.string().min(1).optional(),
}).strict();
export const SessionListPayloadSchema = z.object({}).strict();
export const SessionMessageListPayloadSchema = z.union([
  z.object({ sessionId: z.string().min(1) }).strict(),
  z.object({ runIds: z.array(z.string().min(1)).min(1).max(200) }).strict(),
]);
export const SessionTimelineListPayloadSchema = z.object({
  projectId: z.string().min(1), sessionId: z.string().min(1), runId: z.string().min(1).optional(),
}).strict();
export const SessionHydrationGetPayloadSchema = z.object({
  projectId: z.string().min(1), sessionId: z.string().min(1),
}).strict();
export const SessionContextUsageGetPayloadSchema = z.object({
  sessionId: z.string().min(1),
}).strict();
export const SessionMessageSendPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(), projectId: z.string().min(1), text: z.string(),
  attachments: z.array(z.object({
    draftAttachmentId: z.string().min(1),
    type: z.literal('image'),
    name: z.string().optional(),
    declaredMimeType: z.string().optional(),
    source: z.object({ type: z.literal('host_file_reference'), referenceId: z.string().min(1) }).strict(),
  }).strict()).max(IMAGE_INPUT_POLICY.maxImageCount).optional(),
  branchMarkerId: z.string().min(1).optional(),
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
export const ImageInputCapabilitiesPayloadSchema = z.object({}).strict();
export const ImageInputSelectPayloadSchema = z.object({}).strict();
export const AttachmentImageReadPayloadSchema = z.object({ attachmentId: z.string().min(1) }).strict();

const HostFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean().optional(),
}).strict();

const SelectedImageUiDtoSchema = z.object({
  draftAttachmentId: z.string().min(1),
  name: z.string().min(1),
  declaredMimeType: z.string().optional(),
  referenceId: z.string().min(1),
  previewDataUrl: z.string(),
}).strict();
export type SelectedImageUiDto = z.infer<typeof SelectedImageUiDtoSchema>;
export type ChatImageInputCapabilitiesUiResult = z.infer<typeof ChatImageInputCapabilitiesUiResultSchema>;
export const ChatImageInputCapabilitiesUiResultSchema = z.object({
  allowedMediaTypes: z.array(z.string()),
  maxImageCount: z.number().int().positive(),
  maxImageBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
}).strict();
export const ChatSelectImagesUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), images: z.array(SelectedImageUiDtoSchema) }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatReadAttachmentImageUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), dataUrl: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export type ChatSelectImagesUiResult = z.infer<typeof ChatSelectImagesUiResultSchema>;
export type ChatReadAttachmentImageUiRequest = z.infer<typeof AttachmentImageReadPayloadSchema>;
export type ChatReadAttachmentImageUiResult = z.infer<typeof ChatReadAttachmentImageUiResultSchema>;

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
export const ChatCreateSessionUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), session: ChatSessionUiDtoSchema }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatListSessionsUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), sessions: z.array(ChatSessionUiDtoSchema) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatListMessagesUiResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    messages: z.array(z.object({
      id: z.string().min(1), sessionId: z.string().min(1), runId: z.string().min(1).optional(),
      role: z.enum(['user', 'assistant', 'toolResult']), text: z.string(), createdAt: z.string().datetime(),
    }).strict()),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
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
export const ChatCancelUserInputUiPayloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('not_found'), runId: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('not_cancellable'),
    run: ChatRunUiDtoSchema,
    reason: z.enum(['already_terminal', 'not_running']),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    failure: z.object({
      code: z.string().min(1),
      message: z.string(),
      retryable: z.boolean().optional(),
    }).strict(),
  }).strict(),
]);
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
    status: z.literal('available'),
    usage: z.object({
      usedTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative(), remainingTokens: z.number(),
      usedPercent: z.number().nonnegative(), autoCompactPercent: z.number().nonnegative(),
      accuracy: z.enum(['provider_reported', 'estimated']),
    }).strict(),
  }).strict(),
  z.object({ status: z.literal('not_available') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);

export interface SessionBranchHostPort {
  createBranchDraft: SessionBranchService['createBranchDraft'];
  cancelBranchDraft: SessionBranchService['cancelBranchDraft'];
}

export type ChatContextUsagePort = Pick<ContextService, 'getSessionUsageSnapshot'>;

export type ImagePickerPort = {
  selectImages(): Promise<
    | { status: 'selected'; images: SelectedImageUiDto[] }
    | { status: 'cancelled' }
  >;
};

export function createChatHost(options: {
  agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'>;
  commandService: Pick<CommandService, 'getCommandSuggestions'>;
  sessionService: SessionService;
  workspaceService: Pick<WorkspaceService, 'listWorkspaces'>;
  branchService: SessionBranchHostPort;
  sessionTimelineQuery: SessionTimelineQuery;
  contextService: ChatContextUsagePort;
  imagePicker?: ImagePickerPort;
}): ChatHost {
  return {
    async createSession(request) {
      const result = options.sessionService.createSession({
        workspace_id: request.projectId,
        ...(request.title ? { title: request.title } : {}),
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'created', session: toChatSessionUiDto(result.session) };
    },

    async listSessions() {
      const sessions: Session[] = [];
      const workspaces = await options.workspaceService.listWorkspaces();
      for (const workspace of workspaces.workspaces) {
        const result = options.sessionService.listSessions({ workspace_id: workspace.workspace_id });
        if (result.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(result.failure) };
        }
        sessions.push(...result.sessions);
      }
      return { status: 'ok', sessions: sessions.map(toChatSessionUiDto) };
    },

    async listMessages(request) {
      if ('runIds' in request) {
        const result = options.sessionService.listUserMessagesByRunIds({
          run_ids: request.runIds,
        });
        if (result.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(result.failure) };
        }
        return {
          status: 'ok',
          messages: result.messages.map((message) => toChatMessageUiDto({
            message,
            attachments: [],
          })),
        };
      }
      const result = options.sessionService.getActiveConversationHistory({
          session_id: request.sessionId,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok', messages: result.messages.map(toChatMessageUiDto) };
    },

    async listTimeline(request) {
      return options.sessionTimelineQuery.listSessionTimeline({
        workspace_id: request.projectId,
        session_id: request.sessionId,
        ...(request.runId ? { run_id: request.runId } : {}),
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
        ...(request.branchMarkerId ? { branch_marker_id: request.branchMarkerId } : {}),
        user_input: {
          text: request.text,
          ...(request.attachments ? {
            attachments: request.attachments.map((attachment) => ({
              draft_attachment_id: attachment.draftAttachmentId,
              type: attachment.type,
              ...(attachment.name ? { name: attachment.name } : {}),
              ...(attachment.declaredMimeType ? { declared_mime_type: attachment.declaredMimeType } : {}),
              source: {
                type: attachment.source.type,
                reference_id: attachment.source.referenceId,
              },
            })),
          } : {}),
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

    getInputCapabilities() {
      return {
        allowedMediaTypes: [...IMAGE_INPUT_POLICY.allowedMediaTypes],
        maxImageCount: IMAGE_INPUT_POLICY.maxImageCount,
        maxImageBytes: IMAGE_INPUT_POLICY.maxImageBytes,
        maxTotalBytes: IMAGE_INPUT_POLICY.maxTotalBytes,
      };
    },

    async selectImages() {
      if (!options.imagePicker) {
        return { status: 'failed', failure: { code: 'image_picker_unavailable', message: 'Image picker is unavailable.' } };
      }
      try {
        return await options.imagePicker.selectImages();
      } catch {
        return { status: 'failed', failure: { code: 'image_picker_failed', message: 'Images could not be selected.' } };
      }
    },

    async readAttachmentImage(request) {
      const result = await options.sessionService.readAttachmentContent({ attachment_id: request.attachmentId });
      if (result.status === 'failed') return { status: 'failed', failure: toHostFailure(result.failure) };
      return {
        status: 'ok',
        dataUrl: `data:${result.content.media_type};base64,${encodeBase64(result.content.bytes)}`,
      };
    },

    async cancelUserInput(request) {
      const result = await options.agentRunService.cancelRun({ run_id: request.runId });
      if (result.status === 'cancelled') {
        return { payload: { status: 'cancelled' }, events: asyncIterableFrom(result.events) };
      }
      if (result.status === 'not_found') {
        return { payload: { status: 'not_found', runId: result.run_id } };
      }
      if (result.status === 'not_cancellable') {
        return {
          payload: {
            status: 'not_cancellable',
            run: toChatRunUiDto(result.run),
            reason: result.reason,
          },
        };
      }
      return {
        payload: {
          status: 'failed',
          failure: {
            code: result.failure.code,
            message: result.failure.message,
            ...(result.failure.retryable !== undefined ? { retryable: result.failure.retryable } : {}),
          },
        },
        ...(result.events ? { events: asyncIterableFrom(result.events) } : {}),
      };
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

    async listRuns(_request) {
      return { runs: [] };
    },

    async listRunEvents(_request) {
      return { events: [] };
    },

    async getSessionHydration(request) {
      const timeline = options.sessionTimelineQuery.listSessionTimeline({
        workspace_id: request.projectId,
        session_id: request.sessionId,
      });
      return {
        messages: timeline.messages,
        diagnostics: timeline.diagnostics,
        runs: [],
        runtimeEvents: [],
      };
    },

    async getContextUsage(request) {
      return mapSessionUsageSnapshot(options.contextService.getSessionUsageSnapshot({
        sessionId: request.sessionId,
      }));
    },
  };
}

function mapSessionUsageSnapshot(result: GetSessionUsageSnapshotResult): ChatGetContextUsageUiResult {
  if (result.status === 'available') {
    return {
      status: 'available',
      usage: {
        usedTokens: result.snapshot.usage.usedTokens,
        totalTokens: result.snapshot.usage.contextWindowTokens,
        remainingTokens: result.snapshot.usage.remainingTokens,
        usedPercent: Math.round(result.snapshot.usage.usedRatio * 100),
        autoCompactPercent: Math.round(result.snapshot.usage.compactionThresholdRatio * 100),
        accuracy: result.snapshot.accuracy,
      },
    };
  }
  if (result.status === 'failed') {
    return { status: 'failed', failure: toHostFailure(result.failure) };
  }
  return { status: 'not_available' };
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
      ...(result.events ? { events: asyncIterableFrom(result.events) } : {}),
    };
  }

  return {
    type: 'error',
    ...(result.session ? { session: toChatSessionUiDto(result.session) } : {}),
    requestId: result.request_id,
    message: result.failure.message,
    ...(result.events ? { events: asyncIterableFrom(result.events) } : {}),
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
  role: 'user' | 'assistant' | 'toolResult';
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
export type ChatHostFailure = {
  code: string;
  message: string;
  retryable?: boolean;
};
export type ChatCreateSessionUiResult =
  | { status: 'created'; session: ChatSessionUiDto }
  | { status: 'failed'; failure: ChatHostFailure };

export interface ChatListSessionsUiRequest {}
export type ChatListSessionsUiResult =
  | { status: 'ok'; sessions: ChatSessionUiDto[] }
  | { status: 'failed'; failure: ChatHostFailure };

export type ChatListMessagesUiRequest =
  | { sessionId: string }
  | { runIds: string[] };
export type ChatListMessagesUiResult =
  | { status: 'ok'; messages: ChatSessionMessageUiDto[] }
  | { status: 'failed'; failure: ChatHostFailure };

export interface ChatListTimelineUiRequest {
  projectId: string;
  sessionId: string;
  runId?: string;
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
  branchMarkerId?: string;
  text: string;
  attachments?: Array<{
    draftAttachmentId: string;
    type: 'image';
    name?: string;
    declaredMimeType?: string;
    source: { type: 'host_file_reference'; referenceId: string };
  }>;
  clientMessageId?: string;
  createdAt?: string;
  modelSelection: {
    provider_id: string;
    model_id: string;
  };
  permissionMode?: PermissionMode;
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

export type PermissionMode = 'default' | 'accept_edits' | 'plan' | 'auto';

export interface ChatCancelUserInputUiRequest {
  runId: string;
}
export type ChatCancelUserInputUiPayload =
  | { status: 'cancelled' }
  | { status: 'not_found'; runId: string }
  | { status: 'not_cancellable'; run: ChatRunUiDto; reason: 'already_terminal' | 'not_running' }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };
export interface ChatCancelUserInputUiResult {
  payload: ChatCancelUserInputUiPayload;
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
}

export type ChatContextUsageUiDto = {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedPercent: number;
  autoCompactPercent: number;
  accuracy: 'provider_reported' | 'estimated';
};

export type ChatGetContextUsageUiResult =
  | { status: 'available'; usage: ChatContextUsageUiDto }
  | { status: 'not_available' }
  | { status: 'failed'; failure: ChatHostFailure };

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
    role: message.conversation.role,
    text: sessionConversationText(message.conversation),
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

function toHostFailure(failure: { code: string; message: string; retryable?: boolean }): ChatHostFailure {
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
  };
}
