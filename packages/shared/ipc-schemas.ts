import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IsoDateTimeSchema,
  RuntimeIpcRequestIdSchema,
} from './ipc-contracts';
import {
  AgentRunSchema,
  AgentSessionSchema,
  MessageSchema,
} from './agent-lifecycle-contracts';
import {
  AgentContextSchema,
  ContextSourceRefSchema,
} from './agent-context-contracts';
import {
  RunModeSchema,
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
} from './agent-run-mode-contracts';
import {
  ApprovalRecordSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
} from './tool-contracts';
import {
  AgentCancelRequestSchema,
  AgentRecoverableRunSummarySchema,
  AgentResumeRequestSchema,
  AgentRetryRequestSchema,
} from './agent-recovery-contracts';
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

export const AgentSessionCreateDataSchema = z.object({ session: AgentSessionSchema }).strict();

export const AgentSessionListPayloadSchema = z.object({}).strict();

export const AgentSessionListDataSchema = z
  .object({
    sessions: z.array(AgentSessionSchema),
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
    run: AgentRunSchema,
    message: MessageSchema.optional(),
  })
  .strict();

export const AgentContextBaselineGetPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentContextBaselineGetDataSchema = z
  .object({
    context: AgentContextSchema.optional(),
  })
  .strict();

export const AgentContextSourcesListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const AgentContextSourcesListDataSchema = z
  .object({
    sources: z.array(ContextSourceRefSchema),
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
    runs: z.array(AgentRecoverableRunSummarySchema),
  })
  .strict();

export const AgentRunResumePayloadSchema = AgentResumeRequestSchema.omit({
  resumeRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunResumeDataSchema = z
  .object({
    request: AgentResumeRequestSchema,
  })
  .strict();

export const AgentRunCancelPayloadSchema = AgentCancelRequestSchema.omit({
  cancelRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunCancelDataSchema = z
  .object({
    request: AgentCancelRequestSchema,
  })
  .strict();

export const AgentRunRetryPayloadSchema = AgentRetryRequestSchema.omit({
  retryRequestId: true,
  createdAt: true,
}).strict();

export const AgentRunRetryDataSchema = z
  .object({
    request: AgentRetryRequestSchema,
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

export type ProviderListPayload = z.infer<typeof ProviderListPayloadSchema>;
export type ProviderListData = z.infer<typeof ProviderListDataSchema>;
export type ProviderUpdatePayload = z.infer<typeof ProviderUpdatePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof ProviderDeleteApiKeyPayloadSchema>;
export type ProviderEmptyData = z.infer<typeof ProviderEmptyDataSchema>;
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
