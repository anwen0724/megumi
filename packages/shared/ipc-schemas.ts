import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IsoDateTimeSchema,
  RuntimeIpcRequestIdSchema,
} from './ipc-contracts';
import {
  RunSchema,
  SessionMessageSchema,
  SessionSchema,
} from './session-run-contracts';
import {
  RunContextSchema,
  RunContextSourceSchema,
} from './run-context-contracts';
import {
  RunModeSchema,
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
} from './run-mode-contracts';
import {
  ApprovalRecordSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
} from './tool-contracts';
import {
  CancelRequestSchema,
  RecoverableRunSummarySchema,
  ResumeRequestSchema,
  RetryRequestSchema,
} from './recovery-contracts';
import {
  ArtifactContentTypeSchema,
  ArtifactRelationSchema,
  ArtifactSchema,
  ArtifactSourceRefSchema,
  ArtifactStatusSchema,
  ArtifactVersionSchema,
} from './artifact-contracts';
import {
  MemoryAccessLogSchema,
  MemoryCandidateSchema,
  MemoryCandidateStatusSchema,
  MemoryKindSchema,
  MemoryRecallRequestSchema,
  MemoryRecallResultSchema,
  MemoryRecordSchema,
  MemoryRecordStatusSchema,
  MemoryScopeSchema,
  MemorySettingsSchema,
  MemorySourceRefSchema,
} from './memory-contracts';
import { RuntimeEventSchema } from './runtime-event-schemas';
import { IPC_CHANNELS } from './ipc-channels';
import { PROVIDER_IDS, type ProviderId } from './provider-contracts';

const PROVIDER_ID_VALUES = [...PROVIDER_IDS] as [ProviderId, ...ProviderId[]];

export const ProviderIdSchema = z.enum(PROVIDER_ID_VALUES);

export const ProviderCredentialSourceSchema = z.enum([
  'secret-store',
  'environment',
  'config',
  'missing',
]);

export const ProviderPublicStatusSchema = z
  .object({
    providerId: ProviderIdSchema,
    displayName: z.string().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().url().optional(),
    defaultModelId: z.string().min(1),
    hasSecret: z.boolean(),
    credentialSource: ProviderCredentialSourceSchema,
    envOverrideActive: z.boolean(),
  })
  .strict();

export const ProviderListPayloadSchema = z.object({}).strict();

export const ProviderListDataSchema = z
  .object({
    providers: z.array(ProviderPublicStatusSchema),
  })
  .strict();

export const ProviderUpdatePayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
    enabled: z.boolean().optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    defaultModelId: z.string().min(1).optional(),
  })
  .strict();

export const ProviderApiKeyPayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
    apiKey: z.string().min(1),
  })
  .strict();

export const ProviderDeleteApiKeyPayloadSchema = z
  .object({
    providerId: ProviderIdSchema,
  })
  .strict();

export const ProviderEmptyDataSchema = z.object({}).strict();

export const ProviderListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.list,
  ProviderListPayloadSchema,
);

export const ProviderUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.update,
  ProviderUpdatePayloadSchema,
);

export const ProviderApiKeyRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.setApiKey,
  ProviderApiKeyPayloadSchema,
);

export const ProviderDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.provider.deleteApiKey,
  ProviderDeleteApiKeyPayloadSchema,
);

export const ProviderListResultSchema = createRuntimeIpcResultSchema(
  ProviderListDataSchema,
  IPC_CHANNELS.provider.list,
);

export const ProviderUpdateResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.update,
);

export const ProviderApiKeyResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.setApiKey,
);

export const ProviderDeleteApiKeyResultSchema = createRuntimeIpcResultSchema(
  ProviderEmptyDataSchema,
  IPC_CHANNELS.provider.deleteApiKey,
);

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export const ComposerModeSchema = z.enum(['chat', 'agent', 'plan']);

export const ChatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: ChatRoleSchema,
    content: z.string(),
    createdAt: IsoDateTimeSchema,
    name: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

export const ChatRuntimeContextSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    workspaceLabel: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    sessionTitle: z.string().min(1).optional(),
    composerMode: ComposerModeSchema.optional(),
  })
  .strict();

export const ChatStartPayloadSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    providerId: ProviderIdSchema,
    modelId: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    context: ChatRuntimeContextSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ChatStartDataSchema = z
  .object({
    requestId: RuntimeIpcRequestIdSchema,
  })
  .strict();

export const ChatCancelPayloadSchema = z
  .object({
    targetRequestId: RuntimeIpcRequestIdSchema,
  })
  .strict();

export const ChatCancelDataSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const ChatStartRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.start,
  ChatStartPayloadSchema,
);

export const ChatCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.chat.cancel,
  ChatCancelPayloadSchema,
);

export const ChatStartResultSchema = createRuntimeIpcResultSchema(
  ChatStartDataSchema,
  IPC_CHANNELS.chat.start,
);

export const ChatCancelResultSchema = createRuntimeIpcResultSchema(
  ChatCancelDataSchema,
  IPC_CHANNELS.chat.cancel,
);

export const AgentSessionCreatePayloadSchema = z
  .object({
    title: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentSessionCreateDataSchema = z.object({ session: SessionSchema }).strict();

export const AgentSessionListPayloadSchema = z.object({}).strict();

export const AgentSessionListDataSchema = z
  .object({
    sessions: z.array(SessionSchema),
  })
  .strict();

export const AgentRunStartPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    triggerMessageId: z.string().min(1).optional(),
    goal: z.string().min(1),
    mode: z.string().min(1),
    modeSnapshot: RunModeSchema.optional(),
    sourcePlanId: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentRunStartDataSchema = z
  .object({
    run: RunSchema,
    message: SessionMessageSchema.optional(),
  })
  .strict();

export const AgentContextBaselineGetPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentContextBaselineGetDataSchema = z
  .object({
    context: RunContextSchema.optional(),
  })
  .strict();

export const AgentContextSourcesListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentContextSourcesListDataSchema = z
  .object({
    sources: z.array(RunContextSourceSchema),
  })
  .strict();

export const AgentPlanByRunGetPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentPlanByRunGetDataSchema = z
  .object({
    plan: ImplementationPlanArtifactRecordSchema.optional(),
  })
  .strict();

export const AgentPlanStatusUpdatePayloadSchema = z
  .object({
    planArtifactId: z.string().min(1),
    status: ImplementationPlanArtifactStatusSchema,
    supersededByPlanId: z.string().min(1).optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentPlanStatusUpdateDataSchema = z
  .object({
    plan: ImplementationPlanArtifactRecordSchema,
  })
  .strict();

export const AgentToolDefinitionsListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentToolDefinitionsListDataSchema = z
  .object({
    tools: z.array(ToolDefinitionSchema),
  })
  .strict();

export const AgentToolCallGetPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
  })
  .strict();

export const AgentToolCallGetDataSchema = z
  .object({
    toolCall: ToolCallSchema.optional(),
  })
  .strict();

export const AgentApprovalResolvePayloadSchema = z
  .object({
    approvalRequestId: z.string().min(1),
    decision: z.enum(['approved', 'denied']),
    scope: z.enum(['once', 'run']),
    reason: z.string().min(1).optional(),
    decidedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentApprovalResolveDataSchema = z
  .object({
    approval: ApprovalRecordSchema,
  })
  .strict();

export const AgentRecoverableRunListPayloadSchema = z.object({}).strict();

export const AgentRecoverableRunListDataSchema = z
  .object({
    runs: z.array(RecoverableRunSummarySchema),
  })
  .strict();

export const AgentRunResumePayloadSchema = ResumeRequestSchema.omit({
  resumeRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunResumeDataSchema = z
  .object({
    request: ResumeRequestSchema,
  })
  .strict();

export const AgentRunCancelPayloadSchema = CancelRequestSchema.omit({
  cancelRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunCancelDataSchema = z
  .object({
    request: CancelRequestSchema,
  })
  .strict();

export const AgentRunRetryPayloadSchema = RetryRequestSchema.omit({
  retryRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunRetryDataSchema = z
  .object({
    request: RetryRequestSchema,
  })
  .strict();

export const AgentArtifactListByRunPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentArtifactListBySessionPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export const AgentArtifactGetPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
  })
  .strict();

export const AgentArtifactVersionGetPayloadSchema = z
  .object({
    artifactVersionId: z.string().min(1),
  })
  .strict();

export const AgentArtifactVersionCreatePayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    contentType: ArtifactContentTypeSchema,
    contentFormat: z.string().min(1),
    text: z.string(),
    textPreview: z.string(),
    changeSummary: z.string().min(1).optional(),
    createdByRunId: z.string().min(1),
    createdByStepId: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const AgentArtifactStatusUpdatePayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    status: ArtifactStatusSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentArtifactReferencePayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1).optional(),
    referencedByKind: z.enum(['run', 'step', 'artifact', 'message']),
    referencedById: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const AgentArtifactListDataSchema = z
  .object({
    artifacts: z.array(ArtifactSchema),
  })
  .strict();

export const AgentArtifactGetDataSchema = z
  .object({
    artifact: ArtifactSchema.optional(),
    currentVersion: ArtifactVersionSchema.optional(),
    sourceRefs: z.array(ArtifactSourceRefSchema),
    relations: z.array(ArtifactRelationSchema),
  })
  .strict();

export const AgentArtifactVersionGetDataSchema = z
  .object({
    version: ArtifactVersionSchema.optional(),
  })
  .strict();

export const AgentArtifactVersionCreateDataSchema = z
  .object({
    version: ArtifactVersionSchema,
  })
  .strict();

export const AgentArtifactStatusUpdateDataSchema = z
  .object({
    artifact: ArtifactSchema,
  })
  .strict();

export const AgentArtifactReferenceDataSchema = z
  .object({
    sourceRef: ArtifactSourceRefSchema,
  })
  .strict();

export const AgentMemorySettingsGetPayloadSchema = z
  .object({
    workspaceId: z.string().min(1),
  })
  .strict();

export const AgentMemorySettingsUpdatePayloadSchema = z
  .object({
    workspaceId: z.string().min(1),
    autoCaptureEnabled: z.boolean(),
    defaultCandidateReviewMode: z.literal('manual'),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentMemorySettingsDataSchema = z.object({ settings: MemorySettingsSchema }).strict();

export const AgentMemoryCandidateListPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    status: MemoryCandidateStatusSchema.optional(),
  })
  .strict();

export const AgentMemoryCandidateAcceptPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const AgentMemoryCandidateRejectPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    rejectionReason: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const AgentMemoryCandidateArchivePayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const AgentMemoryCandidateEditAndAcceptPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    content: z.string().min(1).max(4000),
    summary: z.string().min(1).max(500).optional(),
    scope: MemoryScopeSchema.optional(),
    kind: MemoryKindSchema.optional(),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const AgentMemoryCandidateListDataSchema = z.object({ candidates: z.array(MemoryCandidateSchema) }).strict();
export const AgentMemoryCandidateDataSchema = z.object({ candidate: MemoryCandidateSchema }).strict();
export const AgentMemoryCandidateAcceptDataSchema = z
  .object({ candidate: MemoryCandidateSchema, memory: MemoryRecordSchema })
  .strict();

export const AgentMemoryListPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    scope: MemoryScopeSchema.optional(),
    kind: MemoryKindSchema.optional(),
    status: MemoryRecordStatusSchema.optional(),
    query: z.string().min(1).optional(),
  })
  .strict();

export const AgentMemoryGetPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();

export const AgentMemoryUpdatePayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    content: z.string().min(1).max(4000).optional(),
    summary: z.string().min(1).max(500).optional(),
    scope: MemoryScopeSchema.optional(),
    kind: MemoryKindSchema.optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentMemoryStatusPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentMemorySourceRefsListPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();

export const AgentMemoryAccessLogsListPayloadSchema = z
  .object({
    memoryId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

export const AgentMemoryRecallPreviewPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    scopes: z.array(MemoryScopeSchema).min(1),
    kinds: z.array(MemoryKindSchema).optional(),
    limit: z.number().int().positive().max(50),
    budget: z.number().int().positive().optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentMemoryListDataSchema = z.object({ memories: z.array(MemoryRecordSchema) }).strict();
export const AgentMemoryGetDataSchema = z
  .object({
    memory: MemoryRecordSchema.optional(),
    sourceRefs: z.array(MemorySourceRefSchema),
  })
  .strict();
export const AgentMemoryDataSchema = z.object({ memory: MemoryRecordSchema }).strict();
export const AgentMemorySourceRefsListDataSchema = z.object({ sourceRefs: z.array(MemorySourceRefSchema) }).strict();
export const AgentMemoryAccessLogsListDataSchema = z.object({ accessLogs: z.array(MemoryAccessLogSchema) }).strict();
export const AgentMemoryRecallPreviewDataSchema = z
  .object({
    request: MemoryRecallRequestSchema,
    results: z.array(MemoryRecallResultSchema),
  })
  .strict();

export const SessionMessageSendPayloadSchema = ChatStartPayloadSchema;
export const SessionMessageSendDataSchema = ChatStartDataSchema;
export const SessionMessageCancelPayloadSchema = ChatCancelPayloadSchema;
export const SessionMessageCancelDataSchema = ChatCancelDataSchema;
export const SessionCreatePayloadSchema = AgentSessionCreatePayloadSchema;
export const SessionCreateDataSchema = AgentSessionCreateDataSchema;
export const SessionListPayloadSchema = AgentSessionListPayloadSchema;
export const SessionListDataSchema = AgentSessionListDataSchema;
export const RunStartPayloadSchema = AgentRunStartPayloadSchema;
export const RunStartDataSchema = AgentRunStartDataSchema;
export const RunEventsListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();
export const RunEventsListDataSchema = z
  .object({
    events: z.array(RuntimeEventSchema),
  })
  .strict();
export const RunContextBaselineGetPayloadSchema = AgentContextBaselineGetPayloadSchema;
export const RunContextBaselineGetDataSchema = AgentContextBaselineGetDataSchema;
export const RunContextSourcesListPayloadSchema = AgentContextSourcesListPayloadSchema;
export const RunContextSourcesListDataSchema = AgentContextSourcesListDataSchema;
export const PlanByRunGetPayloadSchema = AgentPlanByRunGetPayloadSchema;
export const PlanByRunGetDataSchema = AgentPlanByRunGetDataSchema;
export const PlanStatusUpdatePayloadSchema = AgentPlanStatusUpdatePayloadSchema;
export const PlanStatusUpdateDataSchema = AgentPlanStatusUpdateDataSchema;
export const ToolDefinitionsListPayloadSchema = AgentToolDefinitionsListPayloadSchema;
export const ToolDefinitionsListDataSchema = AgentToolDefinitionsListDataSchema;
export const ToolCallGetPayloadSchema = AgentToolCallGetPayloadSchema;
export const ToolCallGetDataSchema = AgentToolCallGetDataSchema;
export const ApprovalResolvePayloadSchema = AgentApprovalResolvePayloadSchema;
export const ApprovalResolveDataSchema = AgentApprovalResolveDataSchema;
export const RecoverableRunListPayloadSchema = AgentRecoverableRunListPayloadSchema;
export const RecoverableRunListDataSchema = AgentRecoverableRunListDataSchema;
export const RunResumePayloadSchema = AgentRunResumePayloadSchema;
export const RunResumeDataSchema = AgentRunResumeDataSchema;
export const RunCancelPayloadSchema = AgentRunCancelPayloadSchema;
export const RunCancelDataSchema = AgentRunCancelDataSchema;
export const RunRetryPayloadSchema = AgentRunRetryPayloadSchema;
export const RunRetryDataSchema = AgentRunRetryDataSchema;
export const ArtifactListByRunPayloadSchema = AgentArtifactListByRunPayloadSchema;
export const ArtifactListBySessionPayloadSchema = AgentArtifactListBySessionPayloadSchema;
export const ArtifactGetPayloadSchema = AgentArtifactGetPayloadSchema;
export const ArtifactVersionGetPayloadSchema = AgentArtifactVersionGetPayloadSchema;
export const ArtifactVersionCreatePayloadSchema = AgentArtifactVersionCreatePayloadSchema;
export const ArtifactStatusUpdatePayloadSchema = AgentArtifactStatusUpdatePayloadSchema;
export const ArtifactReferencePayloadSchema = AgentArtifactReferencePayloadSchema;
export const ArtifactListDataSchema = AgentArtifactListDataSchema;
export const ArtifactGetDataSchema = AgentArtifactGetDataSchema;
export const ArtifactVersionGetDataSchema = AgentArtifactVersionGetDataSchema;
export const ArtifactVersionCreateDataSchema = AgentArtifactVersionCreateDataSchema;
export const ArtifactStatusUpdateDataSchema = AgentArtifactStatusUpdateDataSchema;
export const ArtifactReferenceDataSchema = AgentArtifactReferenceDataSchema;
export const MemorySettingsGetPayloadSchema = AgentMemorySettingsGetPayloadSchema;
export const MemorySettingsUpdatePayloadSchema = AgentMemorySettingsUpdatePayloadSchema;
export const MemorySettingsDataSchema = AgentMemorySettingsDataSchema;
export const MemoryCandidateListPayloadSchema = AgentMemoryCandidateListPayloadSchema;
export const MemoryCandidateAcceptPayloadSchema = AgentMemoryCandidateAcceptPayloadSchema;
export const MemoryCandidateRejectPayloadSchema = AgentMemoryCandidateRejectPayloadSchema;
export const MemoryCandidateArchivePayloadSchema = AgentMemoryCandidateArchivePayloadSchema;
export const MemoryCandidateEditAndAcceptPayloadSchema = AgentMemoryCandidateEditAndAcceptPayloadSchema;
export const MemoryCandidateListDataSchema = AgentMemoryCandidateListDataSchema;
export const MemoryCandidateDataSchema = AgentMemoryCandidateDataSchema;
export const MemoryCandidateAcceptDataSchema = AgentMemoryCandidateAcceptDataSchema;
export const MemoryListPayloadSchema = AgentMemoryListPayloadSchema;
export const MemoryGetPayloadSchema = AgentMemoryGetPayloadSchema;
export const MemoryUpdatePayloadSchema = AgentMemoryUpdatePayloadSchema;
export const MemoryStatusPayloadSchema = AgentMemoryStatusPayloadSchema;
export const MemorySourceRefsListPayloadSchema = AgentMemorySourceRefsListPayloadSchema;
export const MemoryAccessLogsListPayloadSchema = AgentMemoryAccessLogsListPayloadSchema;
export const MemoryRecallPreviewPayloadSchema = AgentMemoryRecallPreviewPayloadSchema;
export const MemoryListDataSchema = AgentMemoryListDataSchema;
export const MemoryGetDataSchema = AgentMemoryGetDataSchema;
export const MemoryDataSchema = AgentMemoryDataSchema;
export const MemorySourceRefsListDataSchema = AgentMemorySourceRefsListDataSchema;
export const MemoryAccessLogsListDataSchema = AgentMemoryAccessLogsListDataSchema;
export const MemoryRecallPreviewDataSchema = AgentMemoryRecallPreviewDataSchema;

export const SessionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.create,
  SessionCreatePayloadSchema,
);

export const SessionListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.list,
  SessionListPayloadSchema,
);

export const SessionMessageSendRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.message.send,
  SessionMessageSendPayloadSchema,
);

export const SessionMessageCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.message.cancel,
  SessionMessageCancelPayloadSchema,
);

export const RunEventsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.run.events.list,
  RunEventsListPayloadSchema,
);

export const RunContextBaselineGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.runContext.baselineGet,
  RunContextBaselineGetPayloadSchema,
);

export const RunContextSourcesListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.runContext.sourcesList,
  RunContextSourcesListPayloadSchema,
);

export const PlanByRunGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.plan.byRunGet,
  PlanByRunGetPayloadSchema,
);

export const PlanStatusUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.plan.statusUpdate,
  PlanStatusUpdatePayloadSchema,
);

export const ToolDefinitionsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.tool.definitionsList,
  ToolDefinitionsListPayloadSchema,
);

export const ToolCallGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.tool.callGet,
  ToolCallGetPayloadSchema,
);

export const ApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.approval.resolve,
  ApprovalResolvePayloadSchema,
);

export const RecoveryRecoverableRunListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.recoverableRunsList,
  RecoverableRunListPayloadSchema,
);

export const RecoveryResumeRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.resume,
  RunResumePayloadSchema,
);

export const RecoveryCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.cancel,
  RunCancelPayloadSchema,
);

export const RecoveryRetryRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.retry,
  RunRetryPayloadSchema,
);
export const RecoverableRunListRequestSchema = RecoveryRecoverableRunListRequestSchema;
export const RunResumeRequestSchema = RecoveryResumeRequestSchema;
export const RunCancelRequestSchema = RecoveryCancelRequestSchema;
export const RunRetryRequestSchema = RecoveryRetryRequestSchema;

export const ArtifactListByRunRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.listByRun,
  ArtifactListByRunPayloadSchema,
);

export const ArtifactListBySessionRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.listBySession,
  ArtifactListBySessionPayloadSchema,
);

export const ArtifactGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.get,
  ArtifactGetPayloadSchema,
);

export const ArtifactVersionGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.versionGet,
  ArtifactVersionGetPayloadSchema,
);

export const ArtifactVersionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.versionCreate,
  ArtifactVersionCreatePayloadSchema,
);

export const ArtifactStatusUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.statusUpdate,
  ArtifactStatusUpdatePayloadSchema,
);

export const ArtifactReferenceRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.artifacts.reference,
  ArtifactReferencePayloadSchema,
);

export const MemorySettingsGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.settingsGet,
  MemorySettingsGetPayloadSchema,
);

export const MemorySettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.settingsUpdate,
  MemorySettingsUpdatePayloadSchema,
);

export const MemoryCandidateListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.candidateList,
  MemoryCandidateListPayloadSchema,
);

export const MemoryCandidateAcceptRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.candidateAccept,
  MemoryCandidateAcceptPayloadSchema,
);

export const MemoryCandidateRejectRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.candidateReject,
  MemoryCandidateRejectPayloadSchema,
);

export const MemoryCandidateArchiveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.candidateArchive,
  MemoryCandidateArchivePayloadSchema,
);

export const MemoryCandidateEditAndAcceptRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.candidateEditAndAccept,
  MemoryCandidateEditAndAcceptPayloadSchema,
);

export const MemoryListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryList,
  MemoryListPayloadSchema,
);

export const MemoryGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryGet,
  MemoryGetPayloadSchema,
);

export const MemoryUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryUpdate,
  MemoryUpdatePayloadSchema,
);

export const MemoryArchiveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryArchive,
  MemoryStatusPayloadSchema,
);

export const MemoryDeleteRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryDelete,
  MemoryStatusPayloadSchema,
);

export const MemoryDisableRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryDisable,
  MemoryStatusPayloadSchema,
);

export const MemoryEnableRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.memoryEnable,
  MemoryStatusPayloadSchema,
);

export const MemorySourceRefsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.sourceRefsList,
  MemorySourceRefsListPayloadSchema,
);

export const MemoryAccessLogsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.accessLogsList,
  MemoryAccessLogsListPayloadSchema,
);

export const MemoryRecallPreviewRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.memory.recallPreview,
  MemoryRecallPreviewPayloadSchema,
);

export const AgentSessionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.session.create,
  AgentSessionCreatePayloadSchema,
);

export const AgentSessionListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.session.list,
  AgentSessionListPayloadSchema,
);

export const AgentRunStartRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.run.start,
  AgentRunStartPayloadSchema,
);

export const AgentContextBaselineGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.context.baselineGet,
  AgentContextBaselineGetPayloadSchema,
);

export const AgentContextSourcesListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.context.sourcesList,
  AgentContextSourcesListPayloadSchema,
);

export const AgentPlanByRunGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.plan.byRunGet,
  AgentPlanByRunGetPayloadSchema,
);

export const AgentPlanStatusUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.plan.statusUpdate,
  AgentPlanStatusUpdatePayloadSchema,
);

export const AgentToolDefinitionsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.tool.definitionsList,
  AgentToolDefinitionsListPayloadSchema,
);

export const AgentToolCallGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.tool.callGet,
  AgentToolCallGetPayloadSchema,
);

export const AgentApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.approval.resolve,
  AgentApprovalResolvePayloadSchema,
);

export const AgentRecoverableRunListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.recovery.recoverableRunsList,
  AgentRecoverableRunListPayloadSchema,
);

export const AgentRunResumeRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.recovery.resume,
  AgentRunResumePayloadSchema,
);

export const AgentRunCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.recovery.cancel,
  AgentRunCancelPayloadSchema,
);

export const AgentRunRetryRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.recovery.retry,
  AgentRunRetryPayloadSchema,
);

export const AgentArtifactListByRunRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.listByRun,
  AgentArtifactListByRunPayloadSchema,
);

export const AgentArtifactListBySessionRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.listBySession,
  AgentArtifactListBySessionPayloadSchema,
);

export const AgentArtifactGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.get,
  AgentArtifactGetPayloadSchema,
);

export const AgentArtifactVersionGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.versionGet,
  AgentArtifactVersionGetPayloadSchema,
);

export const AgentArtifactVersionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.versionCreate,
  AgentArtifactVersionCreatePayloadSchema,
);

export const AgentArtifactStatusUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.statusUpdate,
  AgentArtifactStatusUpdatePayloadSchema,
);

export const AgentArtifactReferenceRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.artifacts.reference,
  AgentArtifactReferencePayloadSchema,
);

export const AgentMemorySettingsGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.settingsGet,
  AgentMemorySettingsGetPayloadSchema,
);

export const AgentMemorySettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.settingsUpdate,
  AgentMemorySettingsUpdatePayloadSchema,
);

export const AgentMemoryCandidateListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.candidateList,
  AgentMemoryCandidateListPayloadSchema,
);

export const AgentMemoryCandidateAcceptRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.candidateAccept,
  AgentMemoryCandidateAcceptPayloadSchema,
);

export const AgentMemoryCandidateRejectRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.candidateReject,
  AgentMemoryCandidateRejectPayloadSchema,
);

export const AgentMemoryCandidateArchiveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.candidateArchive,
  AgentMemoryCandidateArchivePayloadSchema,
);

export const AgentMemoryCandidateEditAndAcceptRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.candidateEditAndAccept,
  AgentMemoryCandidateEditAndAcceptPayloadSchema,
);

export const AgentMemoryListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryList,
  AgentMemoryListPayloadSchema,
);

export const AgentMemoryGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryGet,
  AgentMemoryGetPayloadSchema,
);

export const AgentMemoryUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryUpdate,
  AgentMemoryUpdatePayloadSchema,
);

export const AgentMemoryArchiveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryArchive,
  AgentMemoryStatusPayloadSchema,
);

export const AgentMemoryDeleteRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryDelete,
  AgentMemoryStatusPayloadSchema,
);

export const AgentMemoryDisableRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryDisable,
  AgentMemoryStatusPayloadSchema,
);

export const AgentMemoryEnableRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.memoryEnable,
  AgentMemoryStatusPayloadSchema,
);

export const AgentMemorySourceRefsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.sourceRefsList,
  AgentMemorySourceRefsListPayloadSchema,
);

export const AgentMemoryAccessLogsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.accessLogsList,
  AgentMemoryAccessLogsListPayloadSchema,
);

export const AgentMemoryRecallPreviewRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.agent.memory.recallPreview,
  AgentMemoryRecallPreviewPayloadSchema,
);

export const SessionCreateResultSchema = createRuntimeIpcResultSchema(
  SessionCreateDataSchema,
  IPC_CHANNELS.session.create,
);

export const SessionListResultSchema = createRuntimeIpcResultSchema(
  SessionListDataSchema,
  IPC_CHANNELS.session.list,
);

export const SessionMessageSendResultSchema = createRuntimeIpcResultSchema(
  SessionMessageSendDataSchema,
  IPC_CHANNELS.session.message.send,
);

export const SessionMessageCancelResultSchema = createRuntimeIpcResultSchema(
  SessionMessageCancelDataSchema,
  IPC_CHANNELS.session.message.cancel,
);

export const RunEventsListResultSchema = createRuntimeIpcResultSchema(
  RunEventsListDataSchema,
  IPC_CHANNELS.run.events.list,
);

export const RunContextBaselineGetResultSchema = createRuntimeIpcResultSchema(
  RunContextBaselineGetDataSchema,
  IPC_CHANNELS.runContext.baselineGet,
);

export const RunContextSourcesListResultSchema = createRuntimeIpcResultSchema(
  RunContextSourcesListDataSchema,
  IPC_CHANNELS.runContext.sourcesList,
);

export const PlanByRunGetResultSchema = createRuntimeIpcResultSchema(
  PlanByRunGetDataSchema,
  IPC_CHANNELS.plan.byRunGet,
);

export const PlanStatusUpdateResultSchema = createRuntimeIpcResultSchema(
  PlanStatusUpdateDataSchema,
  IPC_CHANNELS.plan.statusUpdate,
);

export const ToolDefinitionsListResultSchema = createRuntimeIpcResultSchema(
  ToolDefinitionsListDataSchema,
  IPC_CHANNELS.tool.definitionsList,
);

export const ToolCallGetResultSchema = createRuntimeIpcResultSchema(
  ToolCallGetDataSchema,
  IPC_CHANNELS.tool.callGet,
);

export const ApprovalResolveResultSchema = createRuntimeIpcResultSchema(
  ApprovalResolveDataSchema,
  IPC_CHANNELS.approval.resolve,
);

export const RecoveryRecoverableRunListResultSchema = createRuntimeIpcResultSchema(
  RecoverableRunListDataSchema,
  IPC_CHANNELS.recovery.recoverableRunsList,
);

export const RecoveryResumeResultSchema = createRuntimeIpcResultSchema(
  RunResumeDataSchema,
  IPC_CHANNELS.recovery.resume,
);

export const RecoveryCancelResultSchema = createRuntimeIpcResultSchema(
  RunCancelDataSchema,
  IPC_CHANNELS.recovery.cancel,
);

export const RecoveryRetryResultSchema = createRuntimeIpcResultSchema(
  RunRetryDataSchema,
  IPC_CHANNELS.recovery.retry,
);
export const RecoverableRunListResultSchema = RecoveryRecoverableRunListResultSchema;
export const RunResumeResultSchema = RecoveryResumeResultSchema;
export const RunCancelResultSchema = RecoveryCancelResultSchema;
export const RunRetryResultSchema = RecoveryRetryResultSchema;

export const ArtifactListByRunResultSchema = createRuntimeIpcResultSchema(
  ArtifactListDataSchema,
  IPC_CHANNELS.artifacts.listByRun,
);

export const ArtifactListBySessionResultSchema = createRuntimeIpcResultSchema(
  ArtifactListDataSchema,
  IPC_CHANNELS.artifacts.listBySession,
);

export const ArtifactGetResultSchema = createRuntimeIpcResultSchema(
  ArtifactGetDataSchema,
  IPC_CHANNELS.artifacts.get,
);

export const ArtifactVersionGetResultSchema = createRuntimeIpcResultSchema(
  ArtifactVersionGetDataSchema,
  IPC_CHANNELS.artifacts.versionGet,
);

export const ArtifactVersionCreateResultSchema = createRuntimeIpcResultSchema(
  ArtifactVersionCreateDataSchema,
  IPC_CHANNELS.artifacts.versionCreate,
);

export const ArtifactStatusUpdateResultSchema = createRuntimeIpcResultSchema(
  ArtifactStatusUpdateDataSchema,
  IPC_CHANNELS.artifacts.statusUpdate,
);

export const ArtifactReferenceResultSchema = createRuntimeIpcResultSchema(
  ArtifactReferenceDataSchema,
  IPC_CHANNELS.artifacts.reference,
);

export const MemorySettingsGetResultSchema = createRuntimeIpcResultSchema(
  MemorySettingsDataSchema,
  IPC_CHANNELS.memory.settingsGet,
);

export const MemorySettingsUpdateResultSchema = createRuntimeIpcResultSchema(
  MemorySettingsDataSchema,
  IPC_CHANNELS.memory.settingsUpdate,
);

export const MemoryCandidateListResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateListDataSchema,
  IPC_CHANNELS.memory.candidateList,
);

export const MemoryCandidateAcceptResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateAcceptDataSchema,
  IPC_CHANNELS.memory.candidateAccept,
);

export const MemoryCandidateRejectResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateDataSchema,
  IPC_CHANNELS.memory.candidateReject,
);

export const MemoryCandidateArchiveResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateDataSchema,
  IPC_CHANNELS.memory.candidateArchive,
);

export const MemoryCandidateEditAndAcceptResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateAcceptDataSchema,
  IPC_CHANNELS.memory.candidateEditAndAccept,
);

export const MemoryListResultSchema = createRuntimeIpcResultSchema(
  MemoryListDataSchema,
  IPC_CHANNELS.memory.memoryList,
);

export const MemoryGetResultSchema = createRuntimeIpcResultSchema(
  MemoryGetDataSchema,
  IPC_CHANNELS.memory.memoryGet,
);

export const MemoryUpdateResultSchema = createRuntimeIpcResultSchema(
  MemoryDataSchema,
  IPC_CHANNELS.memory.memoryUpdate,
);

export const MemoryArchiveResultSchema = createRuntimeIpcResultSchema(
  MemoryDataSchema,
  IPC_CHANNELS.memory.memoryArchive,
);

export const MemoryDeleteResultSchema = createRuntimeIpcResultSchema(
  MemoryDataSchema,
  IPC_CHANNELS.memory.memoryDelete,
);

export const MemoryDisableResultSchema = createRuntimeIpcResultSchema(
  MemoryDataSchema,
  IPC_CHANNELS.memory.memoryDisable,
);

export const MemoryEnableResultSchema = createRuntimeIpcResultSchema(
  MemoryDataSchema,
  IPC_CHANNELS.memory.memoryEnable,
);

export const MemorySourceRefsListResultSchema = createRuntimeIpcResultSchema(
  MemorySourceRefsListDataSchema,
  IPC_CHANNELS.memory.sourceRefsList,
);

export const MemoryAccessLogsListResultSchema = createRuntimeIpcResultSchema(
  MemoryAccessLogsListDataSchema,
  IPC_CHANNELS.memory.accessLogsList,
);

export const MemoryRecallPreviewResultSchema = createRuntimeIpcResultSchema(
  MemoryRecallPreviewDataSchema,
  IPC_CHANNELS.memory.recallPreview,
);

export const AgentSessionCreateResultSchema = createRuntimeIpcResultSchema(
  AgentSessionCreateDataSchema,
  IPC_CHANNELS.agent.session.create,
);

export const AgentSessionListResultSchema = createRuntimeIpcResultSchema(
  AgentSessionListDataSchema,
  IPC_CHANNELS.agent.session.list,
);

export const AgentRunStartResultSchema = createRuntimeIpcResultSchema(
  AgentRunStartDataSchema,
  IPC_CHANNELS.agent.run.start,
);

export const AgentContextBaselineGetResultSchema = createRuntimeIpcResultSchema(
  AgentContextBaselineGetDataSchema,
  IPC_CHANNELS.agent.context.baselineGet,
);

export const AgentContextSourcesListResultSchema = createRuntimeIpcResultSchema(
  AgentContextSourcesListDataSchema,
  IPC_CHANNELS.agent.context.sourcesList,
);

export const AgentPlanByRunGetResultSchema = createRuntimeIpcResultSchema(
  AgentPlanByRunGetDataSchema,
  IPC_CHANNELS.agent.plan.byRunGet,
);

export const AgentPlanStatusUpdateResultSchema = createRuntimeIpcResultSchema(
  AgentPlanStatusUpdateDataSchema,
  IPC_CHANNELS.agent.plan.statusUpdate,
);

export const AgentToolDefinitionsListResultSchema = createRuntimeIpcResultSchema(
  AgentToolDefinitionsListDataSchema,
  IPC_CHANNELS.agent.tool.definitionsList,
);

export const AgentToolCallGetResultSchema = createRuntimeIpcResultSchema(
  AgentToolCallGetDataSchema,
  IPC_CHANNELS.agent.tool.callGet,
);

export const AgentApprovalResolveResultSchema = createRuntimeIpcResultSchema(
  AgentApprovalResolveDataSchema,
  IPC_CHANNELS.agent.approval.resolve,
);

export const AgentArtifactListByRunResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactListDataSchema,
  IPC_CHANNELS.agent.artifacts.listByRun,
);

export const AgentArtifactListBySessionResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactListDataSchema,
  IPC_CHANNELS.agent.artifacts.listBySession,
);

export const AgentArtifactGetResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactGetDataSchema,
  IPC_CHANNELS.agent.artifacts.get,
);

export const AgentArtifactVersionGetResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactVersionGetDataSchema,
  IPC_CHANNELS.agent.artifacts.versionGet,
);

export const AgentArtifactVersionCreateResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactVersionCreateDataSchema,
  IPC_CHANNELS.agent.artifacts.versionCreate,
);

export const AgentArtifactStatusUpdateResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactStatusUpdateDataSchema,
  IPC_CHANNELS.agent.artifacts.statusUpdate,
);

export const AgentArtifactReferenceResultSchema = createRuntimeIpcResultSchema(
  AgentArtifactReferenceDataSchema,
  IPC_CHANNELS.agent.artifacts.reference,
);

export const AgentMemorySettingsGetResultSchema = createRuntimeIpcResultSchema(
  AgentMemorySettingsDataSchema,
  IPC_CHANNELS.agent.memory.settingsGet,
);

export const AgentMemorySettingsUpdateResultSchema = createRuntimeIpcResultSchema(
  AgentMemorySettingsDataSchema,
  IPC_CHANNELS.agent.memory.settingsUpdate,
);

export const AgentMemoryCandidateListResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateListDataSchema,
  IPC_CHANNELS.agent.memory.candidateList,
);

export const AgentMemoryCandidateAcceptResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateAcceptDataSchema,
  IPC_CHANNELS.agent.memory.candidateAccept,
);

export const AgentMemoryCandidateResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateDataSchema,
);

export const AgentMemoryCandidateRejectResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateDataSchema,
  IPC_CHANNELS.agent.memory.candidateReject,
);

export const AgentMemoryCandidateArchiveResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateDataSchema,
  IPC_CHANNELS.agent.memory.candidateArchive,
);

export const AgentMemoryCandidateEditAndAcceptResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryCandidateAcceptDataSchema,
  IPC_CHANNELS.agent.memory.candidateEditAndAccept,
);

export const AgentMemoryListResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryListDataSchema,
  IPC_CHANNELS.agent.memory.memoryList,
);

export const AgentMemoryGetResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryGetDataSchema,
  IPC_CHANNELS.agent.memory.memoryGet,
);

export const AgentMemoryResultSchema = createRuntimeIpcResultSchema(AgentMemoryDataSchema);

export const AgentMemoryUpdateResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryDataSchema,
  IPC_CHANNELS.agent.memory.memoryUpdate,
);

export const AgentMemoryArchiveResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryDataSchema,
  IPC_CHANNELS.agent.memory.memoryArchive,
);

export const AgentMemoryDeleteResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryDataSchema,
  IPC_CHANNELS.agent.memory.memoryDelete,
);

export const AgentMemoryDisableResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryDataSchema,
  IPC_CHANNELS.agent.memory.memoryDisable,
);

export const AgentMemoryEnableResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryDataSchema,
  IPC_CHANNELS.agent.memory.memoryEnable,
);

export const AgentMemorySourceRefsListResultSchema = createRuntimeIpcResultSchema(
  AgentMemorySourceRefsListDataSchema,
  IPC_CHANNELS.agent.memory.sourceRefsList,
);

export const AgentMemoryAccessLogsListResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryAccessLogsListDataSchema,
  IPC_CHANNELS.agent.memory.accessLogsList,
);

export const AgentMemoryRecallPreviewResultSchema = createRuntimeIpcResultSchema(
  AgentMemoryRecallPreviewDataSchema,
  IPC_CHANNELS.agent.memory.recallPreview,
);

export type ProviderListPayload = z.infer<typeof ProviderListPayloadSchema>;
export type ProviderListData = z.infer<typeof ProviderListDataSchema>;
export type ProviderUpdatePayload = z.infer<typeof ProviderUpdatePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof ProviderDeleteApiKeyPayloadSchema>;
export type ProviderEmptyData = z.infer<typeof ProviderEmptyDataSchema>;
export type SessionMessageSendPayload = z.infer<typeof SessionMessageSendPayloadSchema>;
export type SessionMessageSendData = z.infer<typeof SessionMessageSendDataSchema>;
export type SessionMessageCancelPayload = z.infer<typeof SessionMessageCancelPayloadSchema>;
export type SessionMessageCancelData = z.infer<typeof SessionMessageCancelDataSchema>;
export type SessionCreatePayload = z.infer<typeof SessionCreatePayloadSchema>;
export type SessionCreateData = z.infer<typeof SessionCreateDataSchema>;
export type SessionListPayload = z.infer<typeof SessionListPayloadSchema>;
export type SessionListData = z.infer<typeof SessionListDataSchema>;
export type RunStartPayload = z.infer<typeof RunStartPayloadSchema>;
export type RunStartData = z.infer<typeof RunStartDataSchema>;
export type RunEventsListPayload = z.infer<typeof RunEventsListPayloadSchema>;
export type RunEventsListData = z.infer<typeof RunEventsListDataSchema>;
export type RunContextBaselineGetPayload = z.infer<typeof RunContextBaselineGetPayloadSchema>;
export type RunContextBaselineGetData = z.infer<typeof RunContextBaselineGetDataSchema>;
export type RunContextSourcesListPayload = z.infer<typeof RunContextSourcesListPayloadSchema>;
export type RunContextSourcesListData = z.infer<typeof RunContextSourcesListDataSchema>;
export type PlanByRunGetPayload = z.infer<typeof PlanByRunGetPayloadSchema>;
export type PlanByRunGetData = z.infer<typeof PlanByRunGetDataSchema>;
export type PlanStatusUpdatePayload = z.infer<typeof PlanStatusUpdatePayloadSchema>;
export type PlanStatusUpdateData = z.infer<typeof PlanStatusUpdateDataSchema>;
export type ToolDefinitionsListPayload = z.infer<typeof ToolDefinitionsListPayloadSchema>;
export type ToolDefinitionsListData = z.infer<typeof ToolDefinitionsListDataSchema>;
export type ToolCallGetPayload = z.infer<typeof ToolCallGetPayloadSchema>;
export type ToolCallGetData = z.infer<typeof ToolCallGetDataSchema>;
export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;
export type ApprovalResolveData = z.infer<typeof ApprovalResolveDataSchema>;
export type RecoverableRunListPayload = z.infer<typeof RecoverableRunListPayloadSchema>;
export type RecoverableRunListData = z.infer<typeof RecoverableRunListDataSchema>;
export type RunResumePayload = z.infer<typeof RunResumePayloadSchema>;
export type RunResumeData = z.infer<typeof RunResumeDataSchema>;
export type RunCancelPayload = z.infer<typeof RunCancelPayloadSchema>;
export type RunCancelData = z.infer<typeof RunCancelDataSchema>;
export type RunRetryPayload = z.infer<typeof RunRetryPayloadSchema>;
export type RunRetryData = z.infer<typeof RunRetryDataSchema>;
export type ArtifactListByRunPayload = z.infer<typeof ArtifactListByRunPayloadSchema>;
export type ArtifactListBySessionPayload = z.infer<typeof ArtifactListBySessionPayloadSchema>;
export type ArtifactGetPayload = z.infer<typeof ArtifactGetPayloadSchema>;
export type ArtifactVersionGetPayload = z.infer<typeof ArtifactVersionGetPayloadSchema>;
export type ArtifactVersionCreatePayload = z.infer<typeof ArtifactVersionCreatePayloadSchema>;
export type ArtifactStatusUpdatePayload = z.infer<typeof ArtifactStatusUpdatePayloadSchema>;
export type ArtifactReferencePayload = z.infer<typeof ArtifactReferencePayloadSchema>;
export type ArtifactListData = z.infer<typeof ArtifactListDataSchema>;
export type ArtifactGetData = z.infer<typeof ArtifactGetDataSchema>;
export type ArtifactVersionGetData = z.infer<typeof ArtifactVersionGetDataSchema>;
export type ArtifactVersionCreateData = z.infer<typeof ArtifactVersionCreateDataSchema>;
export type ArtifactStatusUpdateData = z.infer<typeof ArtifactStatusUpdateDataSchema>;
export type ArtifactReferenceData = z.infer<typeof ArtifactReferenceDataSchema>;
export type MemorySettingsGetPayload = z.infer<typeof MemorySettingsGetPayloadSchema>;
export type MemorySettingsUpdatePayload = z.infer<typeof MemorySettingsUpdatePayloadSchema>;
export type MemorySettingsData = z.infer<typeof MemorySettingsDataSchema>;
export type MemoryCandidateListPayload = z.infer<typeof MemoryCandidateListPayloadSchema>;
export type MemoryCandidateAcceptPayload = z.infer<typeof MemoryCandidateAcceptPayloadSchema>;
export type MemoryCandidateRejectPayload = z.infer<typeof MemoryCandidateRejectPayloadSchema>;
export type MemoryCandidateArchivePayload = z.infer<typeof MemoryCandidateArchivePayloadSchema>;
export type MemoryCandidateEditAndAcceptPayload = z.infer<typeof MemoryCandidateEditAndAcceptPayloadSchema>;
export type MemoryCandidateListData = z.infer<typeof MemoryCandidateListDataSchema>;
export type MemoryCandidateData = z.infer<typeof MemoryCandidateDataSchema>;
export type MemoryCandidateAcceptData = z.infer<typeof MemoryCandidateAcceptDataSchema>;
export type MemoryListPayload = z.infer<typeof MemoryListPayloadSchema>;
export type MemoryGetPayload = z.infer<typeof MemoryGetPayloadSchema>;
export type MemoryUpdatePayload = z.infer<typeof MemoryUpdatePayloadSchema>;
export type MemoryStatusPayload = z.infer<typeof MemoryStatusPayloadSchema>;
export type MemorySourceRefsListPayload = z.infer<typeof MemorySourceRefsListPayloadSchema>;
export type MemoryAccessLogsListPayload = z.infer<typeof MemoryAccessLogsListPayloadSchema>;
export type MemoryRecallPreviewPayload = z.infer<typeof MemoryRecallPreviewPayloadSchema>;
export type MemoryListData = z.infer<typeof MemoryListDataSchema>;
export type MemoryGetData = z.infer<typeof MemoryGetDataSchema>;
export type MemoryData = z.infer<typeof MemoryDataSchema>;
export type MemorySourceRefsListData = z.infer<typeof MemorySourceRefsListDataSchema>;
export type MemoryAccessLogsListData = z.infer<typeof MemoryAccessLogsListDataSchema>;
export type MemoryRecallPreviewData = z.infer<typeof MemoryRecallPreviewDataSchema>;
export type ChatStartPayload = z.infer<typeof ChatStartPayloadSchema>;
export type ChatStartData = z.infer<typeof ChatStartDataSchema>;
export type ChatCancelPayload = z.infer<typeof ChatCancelPayloadSchema>;
export type ChatCancelData = z.infer<typeof ChatCancelDataSchema>;
export type AgentSessionCreatePayload = z.infer<typeof AgentSessionCreatePayloadSchema>;
export type AgentSessionCreateData = z.infer<typeof AgentSessionCreateDataSchema>;
export type AgentSessionListPayload = z.infer<typeof AgentSessionListPayloadSchema>;
export type AgentSessionListData = z.infer<typeof AgentSessionListDataSchema>;
export type AgentRunStartPayload = z.infer<typeof AgentRunStartPayloadSchema>;
export type AgentRunStartData = z.infer<typeof AgentRunStartDataSchema>;
export type AgentContextBaselineGetPayload = z.infer<typeof AgentContextBaselineGetPayloadSchema>;
export type AgentContextBaselineGetData = z.infer<typeof AgentContextBaselineGetDataSchema>;
export type AgentContextSourcesListPayload = z.infer<typeof AgentContextSourcesListPayloadSchema>;
export type AgentContextSourcesListData = z.infer<typeof AgentContextSourcesListDataSchema>;
export type AgentPlanByRunGetPayload = z.infer<typeof AgentPlanByRunGetPayloadSchema>;
export type AgentPlanByRunGetData = z.infer<typeof AgentPlanByRunGetDataSchema>;
export type AgentPlanStatusUpdatePayload = z.infer<typeof AgentPlanStatusUpdatePayloadSchema>;
export type AgentPlanStatusUpdateData = z.infer<typeof AgentPlanStatusUpdateDataSchema>;
export type AgentToolDefinitionsListPayload = z.infer<typeof AgentToolDefinitionsListPayloadSchema>;
export type AgentToolDefinitionsListData = z.infer<typeof AgentToolDefinitionsListDataSchema>;
export type AgentToolCallGetPayload = z.infer<typeof AgentToolCallGetPayloadSchema>;
export type AgentToolCallGetData = z.infer<typeof AgentToolCallGetDataSchema>;
export type AgentApprovalResolvePayload = z.infer<typeof AgentApprovalResolvePayloadSchema>;
export type AgentApprovalResolveData = z.infer<typeof AgentApprovalResolveDataSchema>;
export type AgentRecoverableRunListPayload = z.infer<typeof AgentRecoverableRunListPayloadSchema>;
export type AgentRecoverableRunListData = z.infer<typeof AgentRecoverableRunListDataSchema>;
export type AgentRunResumePayload = z.infer<typeof AgentRunResumePayloadSchema>;
export type AgentRunResumeData = z.infer<typeof AgentRunResumeDataSchema>;
export type AgentRunCancelPayload = z.infer<typeof AgentRunCancelPayloadSchema>;
export type AgentRunCancelData = z.infer<typeof AgentRunCancelDataSchema>;
export type AgentRunRetryPayload = z.infer<typeof AgentRunRetryPayloadSchema>;
export type AgentRunRetryData = z.infer<typeof AgentRunRetryDataSchema>;
export type AgentArtifactListByRunPayload = z.infer<typeof AgentArtifactListByRunPayloadSchema>;
export type AgentArtifactListBySessionPayload = z.infer<typeof AgentArtifactListBySessionPayloadSchema>;
export type AgentArtifactGetPayload = z.infer<typeof AgentArtifactGetPayloadSchema>;
export type AgentArtifactVersionGetPayload = z.infer<typeof AgentArtifactVersionGetPayloadSchema>;
export type AgentArtifactVersionCreatePayload = z.infer<typeof AgentArtifactVersionCreatePayloadSchema>;
export type AgentArtifactStatusUpdatePayload = z.infer<typeof AgentArtifactStatusUpdatePayloadSchema>;
export type AgentArtifactReferencePayload = z.infer<typeof AgentArtifactReferencePayloadSchema>;
export type AgentArtifactListData = z.infer<typeof AgentArtifactListDataSchema>;
export type AgentArtifactGetData = z.infer<typeof AgentArtifactGetDataSchema>;
export type AgentArtifactVersionGetData = z.infer<typeof AgentArtifactVersionGetDataSchema>;
export type AgentArtifactVersionCreateData = z.infer<typeof AgentArtifactVersionCreateDataSchema>;
export type AgentArtifactStatusUpdateData = z.infer<typeof AgentArtifactStatusUpdateDataSchema>;
export type AgentArtifactReferenceData = z.infer<typeof AgentArtifactReferenceDataSchema>;
export type AgentMemorySettingsGetPayload = z.infer<typeof AgentMemorySettingsGetPayloadSchema>;
export type AgentMemorySettingsUpdatePayload = z.infer<typeof AgentMemorySettingsUpdatePayloadSchema>;
export type AgentMemorySettingsData = z.infer<typeof AgentMemorySettingsDataSchema>;
export type AgentMemoryCandidateListPayload = z.infer<typeof AgentMemoryCandidateListPayloadSchema>;
export type AgentMemoryCandidateAcceptPayload = z.infer<typeof AgentMemoryCandidateAcceptPayloadSchema>;
export type AgentMemoryCandidateRejectPayload = z.infer<typeof AgentMemoryCandidateRejectPayloadSchema>;
export type AgentMemoryCandidateArchivePayload = z.infer<typeof AgentMemoryCandidateArchivePayloadSchema>;
export type AgentMemoryCandidateEditAndAcceptPayload = z.infer<typeof AgentMemoryCandidateEditAndAcceptPayloadSchema>;
export type AgentMemoryCandidateListData = z.infer<typeof AgentMemoryCandidateListDataSchema>;
export type AgentMemoryCandidateData = z.infer<typeof AgentMemoryCandidateDataSchema>;
export type AgentMemoryCandidateAcceptData = z.infer<typeof AgentMemoryCandidateAcceptDataSchema>;
export type AgentMemoryListPayload = z.infer<typeof AgentMemoryListPayloadSchema>;
export type AgentMemoryGetPayload = z.infer<typeof AgentMemoryGetPayloadSchema>;
export type AgentMemoryUpdatePayload = z.infer<typeof AgentMemoryUpdatePayloadSchema>;
export type AgentMemoryStatusPayload = z.infer<typeof AgentMemoryStatusPayloadSchema>;
export type AgentMemorySourceRefsListPayload = z.infer<typeof AgentMemorySourceRefsListPayloadSchema>;
export type AgentMemoryAccessLogsListPayload = z.infer<typeof AgentMemoryAccessLogsListPayloadSchema>;
export type AgentMemoryRecallPreviewPayload = z.infer<typeof AgentMemoryRecallPreviewPayloadSchema>;
export type AgentMemoryListData = z.infer<typeof AgentMemoryListDataSchema>;
export type AgentMemoryGetData = z.infer<typeof AgentMemoryGetDataSchema>;
export type AgentMemoryData = z.infer<typeof AgentMemoryDataSchema>;
export type AgentMemorySourceRefsListData = z.infer<typeof AgentMemorySourceRefsListDataSchema>;
export type AgentMemoryAccessLogsListData = z.infer<typeof AgentMemoryAccessLogsListDataSchema>;
export type AgentMemoryRecallPreviewData = z.infer<typeof AgentMemoryRecallPreviewDataSchema>;
