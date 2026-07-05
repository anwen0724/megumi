/*
 * Desktop IPC payload schemas for renderer-to-main requests.
 */
import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
} from './contracts';
import { IPC_CHANNELS } from './channels';

const EmptyPayloadSchema = z.object({}).strict();
const IsoDateTimeSchema = z.string().datetime();

export const CommandSuggestionsPayloadSchema = z.object({ draft_input: z.string() }).strict();

export const SessionCreatePayloadSchema = z.object({
  title: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
}).strict();

export const SessionMessageListPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const SessionTimelineListPayloadSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
}).strict();

export const SessionMessageSendPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  message: z.object({
    id: z.string().min(1),
    content: z.string(),
    createdAt: IsoDateTimeSchema,
  }).strict().optional(),
  messages: z.array(z.object({
    id: z.string().min(1),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    createdAt: IsoDateTimeSchema,
  }).strict()).optional(),
  context: z.object({
    workspaceId: z.string().min(1).optional(),
    workspaceLabel: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    sessionTitle: z.string().min(1).optional(),
    permissionMode: z.enum(['default', 'plan', 'auto']).optional(),
    permissionSource: z.string().optional(),
  }).passthrough().optional(),
  createdAt: IsoDateTimeSchema,
}).strict();

export const SessionMessageCancelPayloadSchema = z.object({ targetRequestId: z.string().min(1) }).strict();
export const SessionBranchDraftCreatePayloadSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  intent: z.enum(['branch', 'rerun']),
  createdAt: IsoDateTimeSchema,
}).strict();
export const SessionBranchDraftCancelPayloadSchema = z.object({
  sessionId: z.string().min(1),
  branchMarkerId: z.string().min(1),
  createdAt: IsoDateTimeSchema,
}).strict();
export const RunListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const RunEventsListPayloadSchema = z.object({ runId: z.string().min(1) }).strict();

export const SettingsUpdatePayloadSchema = z.record(z.string(), z.unknown());
export const ProviderUpdatePayloadSchema = z.object({
  providerId: z.string().min(1),
  enabled: z.boolean().optional(),
  displayName: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  modelIds: z.array(z.string().min(1)).optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
}).strict();
export const ProviderApiKeyPayloadSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(1),
}).strict();
export const ProviderDeleteApiKeyPayloadSchema = z.object({ providerId: z.string().min(1) }).strict();

export const ApprovalResolvePayloadSchema = z.object({
  approvalRequestId: z.string().min(1),
  decision: z.enum(['approved', 'denied']),
  scope: z.enum(['once', 'session']),
  reason: z.string().min(1).optional(),
  decidedAt: IsoDateTimeSchema,
}).strict();

export const ProjectOpenPayloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export const ProjectRemovePayloadSchema = ProjectOpenPayloadSchema;
export const WorkspaceFilesListPayloadSchema = z.object({
  workspaceRoot: z.string().min(1),
  directoryPath: z.string(),
}).strict();
export const WorkspaceFileOpenPayloadSchema = z.object({
  workspaceRoot: z.string().min(1),
  filePath: z.string().min(1),
}).strict();

export const CommandSuggestionsRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.commandSuggestions,
  CommandSuggestionsPayloadSchema,
);
export const SessionCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionCreate, SessionCreatePayloadSchema);
export const SessionListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionList, EmptyPayloadSchema);
export const SessionMessageListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionMessageList, SessionMessageListPayloadSchema);
export const SessionTimelineListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionTimelineList, SessionTimelineListPayloadSchema);
export const SessionMessageSendRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionMessageSend, SessionMessageSendPayloadSchema);
export const SessionMessageCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionMessageCancel, SessionMessageCancelPayloadSchema);
export const SessionBranchDraftCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.branchDraftCreate, SessionBranchDraftCreatePayloadSchema);
export const SessionBranchDraftCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.branchDraftCancel, SessionBranchDraftCancelPayloadSchema);
export const RunListBySessionRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.runListBySession, RunListBySessionPayloadSchema);
export const RunEventsListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.runEventsList, RunEventsListPayloadSchema);

export const SettingsGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.get, EmptyPayloadSchema);
export const SettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.update, SettingsUpdatePayloadSchema);
export const ProviderListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerList, EmptyPayloadSchema);
export const ProviderUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerUpdate, ProviderUpdatePayloadSchema);
export const ProviderApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerSetApiKey, ProviderApiKeyPayloadSchema);
export const ProviderDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerDeleteApiKey, ProviderDeleteApiKeyPayloadSchema);

export const ApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.approval.resolve, ApprovalResolvePayloadSchema);

export const ProjectListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectList, EmptyPayloadSchema);
export const ProjectUseExistingRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectUseExisting, EmptyPayloadSchema);
export const ProjectOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectOpen, ProjectOpenPayloadSchema);
export const ProjectRemoveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectRemove, ProjectRemovePayloadSchema);
export const WorkspaceFilesListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesList, WorkspaceFilesListPayloadSchema);
export const WorkspaceFileOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesOpen, WorkspaceFileOpenPayloadSchema);

export type CommandSuggestionsPayload = z.infer<typeof CommandSuggestionsPayloadSchema>;
export type SessionCreatePayload = z.infer<typeof SessionCreatePayloadSchema>;
export type SessionMessageListPayload = z.infer<typeof SessionMessageListPayloadSchema>;
export type SessionTimelineListPayload = z.infer<typeof SessionTimelineListPayloadSchema>;
export type SessionMessageSendPayload = z.infer<typeof SessionMessageSendPayloadSchema>;
export type SessionMessageCancelPayload = z.infer<typeof SessionMessageCancelPayloadSchema>;
export type SessionBranchDraftCreatePayload = z.infer<typeof SessionBranchDraftCreatePayloadSchema>;
export type SessionBranchDraftCancelPayload = z.infer<typeof SessionBranchDraftCancelPayloadSchema>;
export type RunListBySessionPayload = z.infer<typeof RunListBySessionPayloadSchema>;
export type RunEventsListPayload = z.infer<typeof RunEventsListPayloadSchema>;
export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;
export type WorkspaceFilesListPayload = z.infer<typeof WorkspaceFilesListPayloadSchema>;
export type WorkspaceFileOpenPayload = z.infer<typeof WorkspaceFileOpenPayloadSchema>;
