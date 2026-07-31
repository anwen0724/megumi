/* Defines the stable, host-neutral Chat protocol used by Product shells. */
import { RuntimeEventSchema, type RuntimeContext, type RuntimeEvent } from '@megumi/events';

import {
  TimelineMessageSchema,
  TimelineUserMessageSchema,
  type TimelineMessage,
  type TimelineUserMessage,
} from '@megumi/projections';
import { z } from 'zod';
import type { RunStatus } from '@megumi/engine';
import { DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';

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
  selectDocuments(): Promise<ChatSelectDocumentsUiResult>;
  readClipboardImage(): Promise<ChatSelectImagesUiResult>;
  readAttachmentImage(request: ChatReadAttachmentImageUiRequest): Promise<ChatReadAttachmentImageUiResult>;
  getAttachmentFileStatus(request: ChatGetAttachmentFileStatusUiRequest): Promise<ChatGetAttachmentFileStatusUiResult>;
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
  skillSelection: z.object({
    type: z.literal('skill'), name: z.string().min(1), skillPath: z.string().min(1),
  }).strict().optional(),
  attachments: z.array(z.discriminatedUnion('type', [
    z.object({
      draftAttachmentId: z.string().min(1),
      type: z.literal('image'),
      name: z.string().optional(),
      declaredMimeType: z.string().optional(),
      source: z.object({ type: z.literal('host_file_reference'), referenceId: z.string().min(1) }).strict(),
    }).strict(),
    z.object({
      draftAttachmentId: z.string().min(1),
      type: z.literal('file'),
      name: z.string().optional(),
      declaredMimeType: z.string().optional(),
      source: z.object({ type: z.literal('host_file_reference'), referenceId: z.string().min(1) }).strict(),
    }).strict(),
  ])).max(IMAGE_INPUT_POLICY.maxImageCount + DOCUMENT_INPUT_POLICY.maxDocumentCount).optional(),
  branchMarkerId: z.string().min(1).optional(),
  clientMessageId: z.string().min(1).optional(), createdAt: IsoDateTimeSchema.optional(),
  modelSelection: z.object({ provider_id: z.string().min(1), model_id: z.string().min(1) }).strict(),
  permissionMode: z.enum(['ask', 'auto', 'full_access']).optional(), permissionSource: z.string().optional(),
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
export const DocumentInputSelectPayloadSchema = z.object({}).strict();
export const ImageInputClipboardReadPayloadSchema = z.object({}).strict();
export const AttachmentImageReadPayloadSchema = z.object({ attachmentId: z.string().min(1) }).strict();
export const AttachmentFileStatusPayloadSchema = z.object({ attachmentId: z.string().min(1) }).strict();

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
const SelectedDocumentUiDtoSchema = z.object({
  draftAttachmentId: z.string().min(1),
  name: z.string().min(1),
  declaredMimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  referenceId: z.string().min(1),
}).strict();
export type SelectedDocumentUiDto = z.infer<typeof SelectedDocumentUiDtoSchema>;
export type ChatImageInputCapabilitiesUiResult = z.infer<typeof ChatImageInputCapabilitiesUiResultSchema>;
export const ChatImageInputCapabilitiesUiResultSchema = z.object({
  allowedMediaTypes: z.array(z.string()),
  maxImageCount: z.number().int().positive(),
  maxImageBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
  allowedDocumentMediaTypes: z.array(z.string()),
  maxDocumentCount: z.number().int().positive(),
  maxDocumentBytes: z.number().int().positive(),
}).strict();
export const ChatSelectImagesUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), images: z.array(SelectedImageUiDtoSchema) }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatSelectDocumentsUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), documents: z.array(SelectedDocumentUiDtoSchema) }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatReadAttachmentImageUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), dataUrl: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ChatGetAttachmentFileStatusUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available') }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export type ChatSelectImagesUiResult = z.infer<typeof ChatSelectImagesUiResultSchema>;
export type ChatSelectDocumentsUiResult = z.infer<typeof ChatSelectDocumentsUiResultSchema>;
export type ChatReadAttachmentImageUiRequest = z.infer<typeof AttachmentImageReadPayloadSchema>;
export type ChatReadAttachmentImageUiResult = z.infer<typeof ChatReadAttachmentImageUiResultSchema>;
export type ChatGetAttachmentFileStatusUiRequest = z.infer<typeof AttachmentFileStatusPayloadSchema>;
export type ChatGetAttachmentFileStatusUiResult = z.infer<typeof ChatGetAttachmentFileStatusUiResultSchema>;

const ChatSessionUiDtoSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), title: z.string(),
  status: z.enum(['active', 'archived']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const ChatRunUiDtoSchema = z.object({
  runId: z.string().min(1), sessionId: z.string().min(1),
  status: z.enum(['running', 'waiting', 'cancelling', 'completed', 'failed', 'cancelled']),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
}).strict();
export const ChatSendUserInputUiPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_run'), session: ChatSessionUiDtoSchema, requestId: z.string(), userMessageId: z.string(),
    userMessage: TimelineUserMessageSchema,
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
    z.object({ kind: z.literal('skill'), name: z.string(), skillPath: z.string() }).strict(),
  ]),
  source_badge: z.string().optional(),
  display: z.object({ primary: z.string(), secondary: z.string().optional(), badge: z.string().optional() }).strict().optional(),
  match: z.object({ field: z.enum(['name', 'alias']), value: z.string(), prefix: z.string() }).strict(),
  displayInput: z.string(), submitInput: z.string(),
  selection: z.object({ type: z.literal('skill'), name: z.string(), skillPath: z.string() }).strict().optional(),
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
  z.object({ status: z.literal('cancellation_requested'), run: ChatRunUiDtoSchema }).strict(),
  z.object({ status: z.literal('cancelling'), run: ChatRunUiDtoSchema }).strict(),
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

export type InputAttachmentPickerPort = {
  selectImages(): Promise<
    | { status: 'selected'; images: SelectedImageUiDto[] }
    | { status: 'cancelled' }
  >;
  readClipboardImage(): Promise<
    | { status: 'selected'; images: SelectedImageUiDto[] }
    | { status: 'cancelled' }
  >;
  selectDocuments(): Promise<
    | { status: 'selected'; documents: SelectedDocumentUiDto[] }
    | { status: 'cancelled' }
  >;
};

export type LocalFileAvailabilityPort = {
  exists(path: string): Promise<boolean>;
};

/*
 * Chat/session UI DTOs exposed to hosts. These are projections of Engine Run
 * and Session facts, not module service contracts.
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
  status: RunStatus;
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
  skillSelection?: { type: 'skill'; name: string; skillPath: string };
  attachments?: Array<{
    draftAttachmentId: string;
    type: 'image' | 'file';
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
      userMessage: TimelineUserMessage;
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

export type PermissionMode = 'ask' | 'auto' | 'full_access';

export interface ChatCancelUserInputUiRequest {
  runId: string;
}
export type ChatCancelUserInputUiPayload =
  | { status: 'cancellation_requested'; run: ChatRunUiDto }
  | { status: 'cancelling'; run: ChatRunUiDto }
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
  source: { kind: 'built_in' } | { kind: 'skill'; name: string; skillPath: string };
  source_badge?: string;
  display?: { primary: string; secondary?: string; badge?: string };
  match: { field: 'name' | 'alias'; value: string; prefix: string };
  displayInput: string;
  submitInput: string;
  selection?: { type: 'skill'; name: string; skillPath: string };
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
