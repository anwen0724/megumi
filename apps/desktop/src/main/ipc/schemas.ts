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
export const SessionContextUsageGetPayloadSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
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
  branchDraft: z.object({
    branchMarkerId: z.string().min(1),
    intent: z.enum(['branch', 'rerun']),
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
    permissionMode: z.enum(['default', 'accept_edits', 'plan', 'auto']).optional(),
    permissionSource: z.string().optional(),
  }).passthrough().optional(),
  createdAt: IsoDateTimeSchema,
}).strict();

export const SessionMessageCancelPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
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
  protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
  displayName: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  modelIds: z.array(z.string().min(1)).optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
}).strict();
export const ProviderDeletePayloadSchema = z.object({ providerId: z.string().min(1) }).strict();
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

export const ArtifactListByRunPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
export const ArtifactListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const ArtifactGetPayloadSchema = z.object({ artifactId: z.string().min(1) }).strict();
export const ArtifactVersionGetPayloadSchema = z.object({ artifactVersionId: z.string().min(1) }).strict();
export const ArtifactVersionCreatePayloadSchema = z.object({
  artifactId: z.string().min(1),
  contentType: z.string().min(1),
  contentFormat: z.string().min(1),
  text: z.string(),
  textPreview: z.string(),
  changeSummary: z.string().min(1).optional(),
  createdByRunId: z.string().min(1),
  createdByStepId: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const ArtifactStatusUpdatePayloadSchema = z.object({
  artifactId: z.string().min(1),
  status: z.enum(['draft', 'active', 'superseded', 'archived', 'failed', 'deleted']),
  updatedAt: IsoDateTimeSchema,
}).strict();
export const ArtifactReferencePayloadSchema = z.object({
  artifactId: z.string().min(1),
  artifactVersionId: z.string().min(1).optional(),
  referencedByKind: z.enum(['run', 'step', 'artifact', 'message']),
  referencedById: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const MemoryCandidateListPayloadSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  status: z.enum(['proposed', 'accepted', 'rejected', 'archived']).optional(),
}).strict();
export const MemoryCandidateAcceptPayloadSchema = z.object({
  candidateId: z.string().min(1),
  reviewedAt: IsoDateTimeSchema,
  reviewedBy: z.string().min(1).optional(),
}).strict();
export const MemoryCandidateRejectPayloadSchema = z.object({
  candidateId: z.string().min(1),
  rejectionReason: z.string().min(1),
  reviewedAt: IsoDateTimeSchema,
  reviewedBy: z.string().min(1).optional(),
}).strict();
export const MemoryCandidateArchivePayloadSchema = z.object({
  candidateId: z.string().min(1),
  reviewedAt: IsoDateTimeSchema,
  reviewedBy: z.string().min(1).optional(),
}).strict();
export const MemoryCandidateEditAndAcceptPayloadSchema = z.object({
  candidateId: z.string().min(1),
  content: z.string().min(1).max(4000),
  summary: z.string().min(1).max(500).optional(),
  scope: z.enum(['user', 'project']).optional(),
  kind: z.enum(['fact', 'preference', 'constraint', 'decision']).optional(),
  reviewedAt: IsoDateTimeSchema,
  reviewedBy: z.string().min(1).optional(),
}).strict();
export const MemoryListPayloadSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  scope: z.enum(['user', 'project']).optional(),
  kind: z.enum(['fact', 'preference', 'constraint', 'decision']).optional(),
  status: z.enum(['active', 'superseded', 'deleted']).optional(),
  query: z.string().min(1).optional(),
}).strict();
export const MemoryGetPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();
export const MemoryUpdatePayloadSchema = z.object({
  memoryId: z.string().min(1),
  content: z.string().min(1).max(4000).optional(),
  summary: z.string().min(1).max(500).optional(),
  scope: z.enum(['user', 'project']).optional(),
  kind: z.enum(['fact', 'preference', 'constraint', 'decision']).optional(),
  updatedAt: IsoDateTimeSchema,
}).strict();
export const MemoryStatusPayloadSchema = z.object({
  memoryId: z.string().min(1),
  updatedAt: IsoDateTimeSchema,
}).strict();
export const MemorySourceRefsListPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();
export const MemoryAccessLogsListPayloadSchema = z.object({
  memoryId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict();
export const MemoryRecallPreviewPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  scopes: z.array(z.enum(['user', 'project'])).min(1),
  kinds: z.array(z.enum(['fact', 'preference', 'constraint', 'decision'])).optional(),
  limit: z.number().int().positive().max(50),
  budget: z.number().int().positive().optional(),
  createdAt: IsoDateTimeSchema,
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
export const SessionContextUsageGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.sessionContextUsageGet, SessionContextUsageGetPayloadSchema);
export const SessionBranchDraftCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.branchDraftCreate, SessionBranchDraftCreatePayloadSchema);
export const SessionBranchDraftCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.branchDraftCancel, SessionBranchDraftCancelPayloadSchema);
export const RunListBySessionRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.runListBySession, RunListBySessionPayloadSchema);
export const RunEventsListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.chat.runEventsList, RunEventsListPayloadSchema);

export const SettingsGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.get, EmptyPayloadSchema);
export const SettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.update, SettingsUpdatePayloadSchema);
export const ProviderListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerList, EmptyPayloadSchema);
export const ProviderUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerUpdate, ProviderUpdatePayloadSchema);
export const ProviderDeleteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerDelete, ProviderDeletePayloadSchema);
export const ProviderApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerSetApiKey, ProviderApiKeyPayloadSchema);
export const ProviderDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerDeleteApiKey, ProviderDeleteApiKeyPayloadSchema);

export const ApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.approval.resolve, ApprovalResolvePayloadSchema);

export const ProjectListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectList, EmptyPayloadSchema);
export const ProjectUseExistingRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectUseExisting, EmptyPayloadSchema);
export const ProjectOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectOpen, ProjectOpenPayloadSchema);
export const ProjectRemoveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectRemove, ProjectRemovePayloadSchema);
export const WorkspaceFilesListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesList, WorkspaceFilesListPayloadSchema);
export const WorkspaceFileOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesOpen, WorkspaceFileOpenPayloadSchema);

export const ArtifactListByRunRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.listByRun, ArtifactListByRunPayloadSchema);
export const ArtifactListBySessionRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.listBySession, ArtifactListBySessionPayloadSchema);
export const ArtifactGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.get, ArtifactGetPayloadSchema);
export const ArtifactVersionGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.versionGet, ArtifactVersionGetPayloadSchema);
export const ArtifactVersionCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.versionCreate, ArtifactVersionCreatePayloadSchema);
export const ArtifactStatusUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.statusUpdate, ArtifactStatusUpdatePayloadSchema);
export const ArtifactReferenceRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.artifacts.reference, ArtifactReferencePayloadSchema);

export const MemoryCandidateListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.candidateList, MemoryCandidateListPayloadSchema);
export const MemoryCandidateAcceptRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.candidateAccept, MemoryCandidateAcceptPayloadSchema);
export const MemoryCandidateRejectRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.candidateReject, MemoryCandidateRejectPayloadSchema);
export const MemoryCandidateArchiveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.candidateArchive, MemoryCandidateArchivePayloadSchema);
export const MemoryCandidateEditAndAcceptRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.candidateEditAndAccept, MemoryCandidateEditAndAcceptPayloadSchema);
export const MemoryListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryList, MemoryListPayloadSchema);
export const MemoryGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryGet, MemoryGetPayloadSchema);
export const MemoryUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryUpdate, MemoryUpdatePayloadSchema);
export const MemoryArchiveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryArchive, MemoryStatusPayloadSchema);
export const MemoryDeleteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryDelete, MemoryStatusPayloadSchema);
export const MemoryDisableRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryDisable, MemoryStatusPayloadSchema);
export const MemoryEnableRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.memoryEnable, MemoryStatusPayloadSchema);
export const MemorySourceRefsListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.sourceRefsList, MemorySourceRefsListPayloadSchema);
export const MemoryAccessLogsListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.accessLogsList, MemoryAccessLogsListPayloadSchema);
export const MemoryRecallPreviewRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.recallPreview, MemoryRecallPreviewPayloadSchema);

export type CommandSuggestionsPayload = z.infer<typeof CommandSuggestionsPayloadSchema>;
export type SessionCreatePayload = z.infer<typeof SessionCreatePayloadSchema>;
export type SessionMessageListPayload = z.infer<typeof SessionMessageListPayloadSchema>;
export type SessionTimelineListPayload = z.infer<typeof SessionTimelineListPayloadSchema>;
export type SessionContextUsageGetPayload = z.infer<typeof SessionContextUsageGetPayloadSchema>;
export type SessionMessageSendPayload = z.infer<typeof SessionMessageSendPayloadSchema>;
export type SessionMessageCancelPayload = z.infer<typeof SessionMessageCancelPayloadSchema>;
export type SessionBranchDraftCreatePayload = z.infer<typeof SessionBranchDraftCreatePayloadSchema>;
export type SessionBranchDraftCancelPayload = z.infer<typeof SessionBranchDraftCancelPayloadSchema>;
export type RunListBySessionPayload = z.infer<typeof RunListBySessionPayloadSchema>;
export type RunEventsListPayload = z.infer<typeof RunEventsListPayloadSchema>;
export type SettingsUpdatePayload = z.infer<typeof SettingsUpdatePayloadSchema>;
export type ProviderUpdatePayload = z.infer<typeof ProviderUpdatePayloadSchema>;
export type ProviderDeletePayload = z.infer<typeof ProviderDeletePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof ProviderDeleteApiKeyPayloadSchema>;
export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;
export type ProjectOpenPayload = z.infer<typeof ProjectOpenPayloadSchema>;
export type ProjectRemovePayload = z.infer<typeof ProjectRemovePayloadSchema>;
export type WorkspaceFilesListPayload = z.infer<typeof WorkspaceFilesListPayloadSchema>;
export type WorkspaceFileOpenPayload = z.infer<typeof WorkspaceFileOpenPayloadSchema>;
export type ArtifactListByRunPayload = z.infer<typeof ArtifactListByRunPayloadSchema>;
export type ArtifactListBySessionPayload = z.infer<typeof ArtifactListBySessionPayloadSchema>;
export type ArtifactGetPayload = z.infer<typeof ArtifactGetPayloadSchema>;
export type ArtifactVersionGetPayload = z.infer<typeof ArtifactVersionGetPayloadSchema>;
export type ArtifactVersionCreatePayload = z.infer<typeof ArtifactVersionCreatePayloadSchema>;
export type ArtifactStatusUpdatePayload = z.infer<typeof ArtifactStatusUpdatePayloadSchema>;
export type ArtifactReferencePayload = z.infer<typeof ArtifactReferencePayloadSchema>;
export type MemoryCandidateListPayload = z.infer<typeof MemoryCandidateListPayloadSchema>;
export type MemoryCandidateAcceptPayload = z.infer<typeof MemoryCandidateAcceptPayloadSchema>;
export type MemoryCandidateRejectPayload = z.infer<typeof MemoryCandidateRejectPayloadSchema>;
export type MemoryCandidateArchivePayload = z.infer<typeof MemoryCandidateArchivePayloadSchema>;
export type MemoryCandidateEditAndAcceptPayload = z.infer<typeof MemoryCandidateEditAndAcceptPayloadSchema>;
export type MemoryListPayload = z.infer<typeof MemoryListPayloadSchema>;
export type MemoryGetPayload = z.infer<typeof MemoryGetPayloadSchema>;
export type MemoryUpdatePayload = z.infer<typeof MemoryUpdatePayloadSchema>;
export type MemoryStatusPayload = z.infer<typeof MemoryStatusPayloadSchema>;
export type MemorySourceRefsListPayload = z.infer<typeof MemorySourceRefsListPayloadSchema>;
export type MemoryAccessLogsListPayload = z.infer<typeof MemoryAccessLogsListPayloadSchema>;
export type MemoryRecallPreviewPayload = z.infer<typeof MemoryRecallPreviewPayloadSchema>;
