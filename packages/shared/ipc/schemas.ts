// Defines strict IPC schemas for renderer-to-main messages and runtime payloads.
// Shared IPC schemas validate transport shape only; runtime services own trusted normalization.
import { z } from 'zod';
import { JsonObjectSchema } from '../primitives/json';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IsoDateTimeSchema,
  RuntimeIpcRequestIdSchema,
} from '../ipc/contracts';
import {
  RunSchema,
  SessionMessageSchema,
  SessionSchema,
} from '../session/run-contracts';
import {
  RunContextSchema,
  RunContextSourceSchema,
} from '../run/context-contracts';
import {
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
  PermissionModeStateSchema,
} from '../permission/snapshot-contracts';
import {
  ApprovalScopeSchema,
  ApprovalRecordSchema,
  ToolDefinitionSchema,
  ToolExecutionSchema,
} from '../tool/contracts';
import {
  PermissionModeSchema,
  PermissionModeSelectionSourceSchema,
} from '../permission/mode-contracts';
import { InputPreprocessingResultSchema } from '../input/preprocessing-contracts';
import {
  CancelRequestSchema,
  RecoverableRunSummarySchema,
  ResumeRequestSchema,
  RetryRequestSchema,
} from '../recovery/contracts';
import {
  ArtifactContentTypeSchema,
  ArtifactRelationSchema,
  ArtifactSchema,
  ArtifactSourceRefSchema,
  ArtifactStatusSchema,
  ArtifactVersionSchema,
} from '../artifact/contracts';
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
  MemorySourceRefSchema,
} from '../memory/contracts';
import {
  AppSettingsRawSchema,
  AppSettingsResolvedSchema,
} from '../settings';
import {
  ProjectListDataSchema,
  ProjectListPayloadSchema,
  ProjectOpenDataSchema,
  ProjectOpenPayloadSchema,
  ProjectRecordSchema,
  ProjectRemoveDataSchema,
  ProjectRemovePayloadSchema,
  ProjectUseExistingDataSchema,
  ProjectUseExistingPayloadSchema,
} from '../project/contracts';
import {
  WorkspaceFileOpenDataSchema,
  WorkspaceFileOpenPayloadSchema,
  WorkspaceFilesListDataSchema,
  WorkspaceFilesListPayloadSchema,
} from '../workspace/file-contracts';
import {
  WorkspaceChangeSummarySchema,
  WorkspaceRestoreFileResultSchema,
  WorkspaceRestoreRequestedBySchema,
  WorkspaceRestoreRequestSchema as WorkspaceRestoreRecordSchema,
  WorkspaceRestoreResultSchema as WorkspaceRestoreRecordResultSchema,
} from '../workspace/change-contracts';
import { TimelineMessageSchema } from '../timeline/message-block-schemas';
import { RuntimeEventSchema } from '../runtime/event-schemas';
import { IPC_CHANNELS } from '../ipc/channels';
import { ProviderIdSchema } from '../provider/contracts';

export { ProjectRecordSchema } from '../project/contracts';

export const ProviderCredentialSourceSchema = z.enum([
  'settings',
  'environment',
  'missing',
]);

export const ProviderPublicStatusSchema = z
  .object({
    providerId: ProviderIdSchema,
    displayName: z.string().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().url().optional(),
    defaultModelId: z.string().min(1),
    hasApiKey: z.boolean(),
    credentialSource: ProviderCredentialSourceSchema,
    envOverrideActive: z.boolean(),
    apiKeyEnv: z.string().min(1).optional(),
    apiKeyEnvCustomized: z.boolean().optional(),
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
    apiKeyEnv: z.string().min(1).nullable().optional(),
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

export const SettingsGetPayloadSchema = z.object({}).strict();

export const SettingsUpdatePayloadSchema = AppSettingsRawSchema;

export const SettingsDataSchema = z.object({
  settings: AppSettingsResolvedSchema,
}).strict();

export const CommandSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('built_in') }).strict(),
  z.object({ kind: z.literal('skill'), skill_id: z.string().min(1) }).strict(),
]);

export const CommandSuggestionItemSchema = z
  .object({
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional(),
    description: z.string().min(1),
    argument_hint: z.string().min(1).optional(),
    source: CommandSourceSchema,
    source_badge: z.string().min(1).optional(),
    match: z
      .object({
        field: z.enum(['name', 'alias']),
        value: z.string(),
        prefix: z.string(),
      })
      .strict(),
    completion: z
      .object({
        replacement_input: z.string(),
      })
      .strict(),
  })
  .strict();

export const CommandSuggestionGroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    items: z.array(CommandSuggestionItemSchema),
  })
  .strict();

export const CommandSuggestionResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inactive') }).strict(),
  z
    .object({
      type: z.literal('suggestions'),
      draft_input: z.string(),
      command_prefix: z.string(),
      groups: z.array(CommandSuggestionGroupSchema),
    })
    .strict(),
]);

export const CommandSuggestionsPayloadSchema = z
  .object({
    draft_input: z.string(),
  })
  .strict();

export const CommandSuggestionsDataSchema = z
  .object({
    suggestions: CommandSuggestionResultSchema,
  })
  .strict();

export const SessionMessageIpcRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const SessionMessageIpcSchema = z
  .object({
    id: z.string().min(1),
    role: SessionMessageIpcRoleSchema,
    content: z.string(),
    createdAt: IsoDateTimeSchema,
    name: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

export const SessionCurrentMessageSchema = z
  .object({
    id: z.string().min(1),
    content: z.string(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionBranchDraftIntentSchema = z.enum(['branch', 'rerun']);

export const SessionBranchDraftPayloadSchema = z
  .object({
    branchMarkerId: z.string().min(1),
    intent: SessionBranchDraftIntentSchema,
  })
  .strict();

export const SessionBranchDraftSchema = z
  .object({
    branchMarkerId: z.string().min(1),
    sessionId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    seedText: z.string(),
    label: z.string().min(1),
    intent: SessionBranchDraftIntentSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionBranchDraftCreatePayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    intent: SessionBranchDraftIntentSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionBranchDraftCreateDataSchema = z
  .object({
    branchDraft: SessionBranchDraftSchema,
  })
  .strict();

export const SessionBranchDraftCancelPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    branchMarkerId: z.string().min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionBranchDraftCancelDataSchema = z
  .object({
    cancelled: z.boolean(),
    reason: z.enum(['branch_has_new_sources', 'branch_marker_not_active', 'branch_marker_not_found']).optional(),
  })
  .strict();

export const SessionMessageRuntimeContextSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    workspaceLabel: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    sessionTitle: z.string().min(1).optional(),
    permissionMode: PermissionModeSchema.optional(),
    permissionSource: PermissionModeSelectionSourceSchema.optional(),
    preprocessing: InputPreprocessingResultSchema.optional(),
  })
  .strict();

export const SessionMessageSendPayloadSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    providerId: ProviderIdSchema,
    modelId: z.string().min(1),
    message: SessionCurrentMessageSchema.optional(),
    messages: z.array(SessionMessageIpcSchema).min(1).optional(),
    context: SessionMessageRuntimeContextSchema.optional(),
    branchDraft: SessionBranchDraftPayloadSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (!payload.message && !payload.messages?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Session message send requires a current message.',
        path: ['message'],
      });
    }
  });

export const SessionMessageSendDataSchema = z
  .object({
    requestId: RuntimeIpcRequestIdSchema,
    session: SessionSchema,
    userMessageId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();

export const SessionMessageCancelPayloadSchema = z
  .object({
    targetRequestId: RuntimeIpcRequestIdSchema,
  })
  .strict();

export const SessionMessageCancelDataSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const SessionMessageListPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export const SessionMessageListDataSchema = z
  .object({
    messages: z.array(SessionMessageSchema),
  })
  .strict();

export const SessionTimelineListPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();

export const SessionTimelineHydrationDiagnosticSchema = z
  .object({
    messageId: z.string().min(1),
    code: z.literal('timeline_message_parse_failed'),
    message: z.string().min(1),
  })
  .strict();

export const SessionTimelineListDataSchema = z
  .object({
    messages: z.array(TimelineMessageSchema),
    diagnostics: z.array(SessionTimelineHydrationDiagnosticSchema),
  })
  .strict();

export const SessionCreatePayloadSchema = z
  .object({
    title: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionCreateDataSchema = z.object({ session: SessionSchema }).strict();

export const SessionListPayloadSchema = z.object({}).strict();

export const SessionListDataSchema = z
  .object({
    sessions: z.array(SessionSchema),
  })
  .strict();

export const RunStartPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    triggerMessageId: z.string().min(1).optional(),
    goal: z.string().min(1),
    mode: z.string().min(1),
    permissionModeState: PermissionModeStateSchema.optional(),
    sourcePlanId: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const RunStartDataSchema = z
  .object({
    run: RunSchema,
    message: SessionMessageSchema.optional(),
  })
  .strict();

export const RunContextBaselineGetPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const RunContextBaselineGetDataSchema = z
  .object({
    context: RunContextSchema.optional(),
  })
  .strict();

export const RunContextSourcesListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const RunContextSourcesListDataSchema = z
  .object({
    sources: z.array(RunContextSourceSchema),
  })
  .strict();

export const PlanByRunGetPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const PlanByRunGetDataSchema = z
  .object({
    plan: ImplementationPlanArtifactRecordSchema.optional(),
  })
  .strict();

export const PlanStatusUpdatePayloadSchema = z
  .object({
    planArtifactId: z.string().min(1),
    status: ImplementationPlanArtifactStatusSchema,
    supersededByPlanId: z.string().min(1).optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const PlanStatusUpdateDataSchema = z
  .object({
    plan: ImplementationPlanArtifactRecordSchema,
  })
  .strict();

export const ToolDefinitionsListPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const ToolDefinitionsListDataSchema = z
  .object({
    tools: z.array(ToolDefinitionSchema),
  })
  .strict();

export const ToolExecutionGetPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
  })
  .strict();

export const ToolExecutionGetDataSchema = z
  .object({
    toolExecution: ToolExecutionSchema.optional(),
  })
  .strict();

export const ApprovalResolvePayloadSchema = z
  .object({
    approvalRequestId: z.string().min(1),
    decision: z.enum(['approved', 'denied']),
    scope: ApprovalScopeSchema,
    reason: z.string().min(1).optional(),
    decidedAt: IsoDateTimeSchema,
  })
  .strict();

export const ApprovalResolveDataSchema = z
  .object({
    approval: ApprovalRecordSchema,
  })
  .strict();

export const RecoverableRunListPayloadSchema = z.object({}).strict();

export const RecoverableRunListDataSchema = z
  .object({
    runs: z.array(RecoverableRunSummarySchema),
  })
  .strict();

export const RunResumePayloadSchema = ResumeRequestSchema.omit({
  resumeRequestId: true,
  createdAt: true,
}).strict();

export const RunResumeDataSchema = z
  .object({
    request: ResumeRequestSchema,
  })
  .strict();

export const RunCancelPayloadSchema = CancelRequestSchema.omit({
  cancelRequestId: true,
  createdAt: true,
}).strict();

export const RunCancelDataSchema = z
  .object({
    request: CancelRequestSchema,
  })
  .strict();

export const RunRetryPayloadSchema = RetryRequestSchema.omit({
  retryRequestId: true,
  createdAt: true,
}).strict();

export const RunRetryDataSchema = z
  .object({
    request: RetryRequestSchema,
  })
  .strict();

export const WorkspaceRestorePayloadSchema = z
  .object({
    changeSetId: z.string().min(1),
    requestedBy: WorkspaceRestoreRequestedBySchema.default('user'),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export const WorkspaceRestoreDataSchema = z
  .object({
    request: WorkspaceRestoreRecordSchema,
    result: WorkspaceRestoreRecordResultSchema,
    fileResults: z.array(WorkspaceRestoreFileResultSchema),
    summary: WorkspaceChangeSummarySchema.optional(),
  })
  .strict();

export const ArtifactListByRunPayloadSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const ArtifactListBySessionPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export const ArtifactGetPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
  })
  .strict();

export const ArtifactVersionGetPayloadSchema = z
  .object({
    artifactVersionId: z.string().min(1),
  })
  .strict();

export const ArtifactVersionCreatePayloadSchema = z
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

export const ArtifactStatusUpdatePayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    status: ArtifactStatusSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ArtifactReferencePayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1).optional(),
    referencedByKind: z.enum(['run', 'step', 'artifact', 'message']),
    referencedById: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const ArtifactListDataSchema = z
  .object({
    artifacts: z.array(ArtifactSchema),
  })
  .strict();

export const ArtifactGetDataSchema = z
  .object({
    artifact: ArtifactSchema.optional(),
    currentVersion: ArtifactVersionSchema.optional(),
    sourceRefs: z.array(ArtifactSourceRefSchema),
    relations: z.array(ArtifactRelationSchema),
  })
  .strict();

export const ArtifactVersionGetDataSchema = z
  .object({
    version: ArtifactVersionSchema.optional(),
  })
  .strict();

export const ArtifactVersionCreateDataSchema = z
  .object({
    version: ArtifactVersionSchema,
  })
  .strict();

export const ArtifactStatusUpdateDataSchema = z
  .object({
    artifact: ArtifactSchema,
  })
  .strict();

export const ArtifactReferenceDataSchema = z
  .object({
    sourceRef: ArtifactSourceRefSchema,
  })
  .strict();

export const MemoryCandidateListPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    status: MemoryCandidateStatusSchema.optional(),
  })
  .strict();

export const MemoryCandidateAcceptPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const MemoryCandidateRejectPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    rejectionReason: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const MemoryCandidateArchivePayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    reviewedAt: IsoDateTimeSchema,
    reviewedBy: z.string().min(1).optional(),
  })
  .strict();

export const MemoryCandidateEditAndAcceptPayloadSchema = z
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

export const MemoryCandidateListDataSchema = z.object({ candidates: z.array(MemoryCandidateSchema) }).strict();
export const MemoryCandidateDataSchema = z.object({ candidate: MemoryCandidateSchema }).strict();
export const MemoryCandidateAcceptDataSchema = z
  .object({ candidate: MemoryCandidateSchema, memory: MemoryRecordSchema })
  .strict();

export const MemoryListPayloadSchema = z
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

export const MemoryGetPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();

export const MemoryUpdatePayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    content: z.string().min(1).max(4000).optional(),
    summary: z.string().min(1).max(500).optional(),
    scope: MemoryScopeSchema.optional(),
    kind: MemoryKindSchema.optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const MemoryStatusPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const MemorySourceRefsListPayloadSchema = z.object({ memoryId: z.string().min(1) }).strict();

export const MemoryAccessLogsListPayloadSchema = z
  .object({
    memoryId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

export const MemoryRecallPreviewPayloadSchema = z
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

export const MemoryListDataSchema = z.object({ memories: z.array(MemoryRecordSchema) }).strict();
export const MemoryGetDataSchema = z
  .object({
    memory: MemoryRecordSchema.optional(),
    sourceRefs: z.array(MemorySourceRefSchema),
  })
  .strict();
export const MemoryDataSchema = z.object({ memory: MemoryRecordSchema }).strict();
export const MemorySourceRefsListDataSchema = z.object({ sourceRefs: z.array(MemorySourceRefSchema) }).strict();
export const MemoryAccessLogsListDataSchema = z.object({ accessLogs: z.array(MemoryAccessLogSchema) }).strict();
export const MemoryRecallPreviewDataSchema = z
  .object({
    request: MemoryRecallRequestSchema,
    results: z.array(MemoryRecallResultSchema),
  })
  .strict();

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

export const RunListBySessionPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();
export const RunListBySessionDataSchema = z
  .object({
    runs: z.array(RunSchema),
  })
  .strict();

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

export const SettingsGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.settings.get,
  SettingsGetPayloadSchema,
);

export const SettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.settings.update,
  SettingsUpdatePayloadSchema,
);

export const CommandSuggestionsRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.command.suggestions,
  CommandSuggestionsPayloadSchema,
);

export const SessionMessageSendRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.message.send,
  SessionMessageSendPayloadSchema,
);

export const SessionMessageCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.message.cancel,
  SessionMessageCancelPayloadSchema,
);

export const SessionBranchDraftCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.branchDraft.create,
  SessionBranchDraftCreatePayloadSchema,
);

export const SessionBranchDraftCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.branchDraft.cancel,
  SessionBranchDraftCancelPayloadSchema,
);

export const SessionMessageListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.message.list,
  SessionMessageListPayloadSchema,
);

export const SessionTimelineListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.timeline.list,
  SessionTimelineListPayloadSchema,
);

export const SessionCreateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.create,
  SessionCreatePayloadSchema,
);

export const SessionListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.session.list,
  SessionListPayloadSchema,
);

export const RunEventsListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.run.events.list,
  RunEventsListPayloadSchema,
);

export const RunListBySessionRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.run.listBySession,
  RunListBySessionPayloadSchema,
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

export const ToolExecutionGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.tool.executionGet,
  ToolExecutionGetPayloadSchema,
);

export const ApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.approval.resolve,
  ApprovalResolvePayloadSchema,
);

export const RecoverableRunListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.recoverableRunsList,
  RecoverableRunListPayloadSchema,
);

export const RunResumeRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.resume,
  RunResumePayloadSchema,
);

export const RunCancelRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.cancel,
  RunCancelPayloadSchema,
);

export const RunRetryRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.retry,
  RunRetryPayloadSchema,
);

export const WorkspaceRestoreRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.recovery.workspaceRestore,
  WorkspaceRestorePayloadSchema,
);

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

export const SettingsGetResultSchema = createRuntimeIpcResultSchema(
  SettingsDataSchema,
  IPC_CHANNELS.settings.get,
);

export const SettingsUpdateResultSchema = createRuntimeIpcResultSchema(
  SettingsDataSchema,
  IPC_CHANNELS.settings.update,
);

export const SessionMessageSendResultSchema = createRuntimeIpcResultSchema(
  SessionMessageSendDataSchema,
  IPC_CHANNELS.session.message.send,
);

export const SessionMessageCancelResultSchema = createRuntimeIpcResultSchema(
  SessionMessageCancelDataSchema,
  IPC_CHANNELS.session.message.cancel,
);

export const SessionBranchDraftCreateResultSchema = createRuntimeIpcResultSchema(
  SessionBranchDraftCreateDataSchema,
  IPC_CHANNELS.session.branchDraft.create,
);

export const SessionBranchDraftCancelResultSchema = createRuntimeIpcResultSchema(
  SessionBranchDraftCancelDataSchema,
  IPC_CHANNELS.session.branchDraft.cancel,
);

export const SessionMessageListResultSchema = createRuntimeIpcResultSchema(
  SessionMessageListDataSchema,
  IPC_CHANNELS.session.message.list,
);

export const SessionTimelineListResultSchema = createRuntimeIpcResultSchema(
  SessionTimelineListDataSchema,
  IPC_CHANNELS.session.timeline.list,
);

export const SessionCreateResultSchema = createRuntimeIpcResultSchema(
  SessionCreateDataSchema,
  IPC_CHANNELS.session.create,
);

export const SessionListResultSchema = createRuntimeIpcResultSchema(
  SessionListDataSchema,
  IPC_CHANNELS.session.list,
);

export const RunEventsListResultSchema = createRuntimeIpcResultSchema(
  RunEventsListDataSchema,
  IPC_CHANNELS.run.events.list,
);

export const RunListBySessionResultSchema = createRuntimeIpcResultSchema(
  RunListBySessionDataSchema,
  IPC_CHANNELS.run.listBySession,
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

export const ToolExecutionGetResultSchema = createRuntimeIpcResultSchema(
  ToolExecutionGetDataSchema,
  IPC_CHANNELS.tool.executionGet,
);

export const ApprovalResolveResultSchema = createRuntimeIpcResultSchema(
  ApprovalResolveDataSchema,
  IPC_CHANNELS.approval.resolve,
);

export const RecoverableRunListResultSchema = createRuntimeIpcResultSchema(
  RecoverableRunListDataSchema,
  IPC_CHANNELS.recovery.recoverableRunsList,
);

export const RunResumeResultSchema = createRuntimeIpcResultSchema(
  RunResumeDataSchema,
  IPC_CHANNELS.recovery.resume,
);

export const RunCancelResultSchema = createRuntimeIpcResultSchema(
  RunCancelDataSchema,
  IPC_CHANNELS.recovery.cancel,
);

export const RunRetryResultSchema = createRuntimeIpcResultSchema(
  RunRetryDataSchema,
  IPC_CHANNELS.recovery.retry,
);

export const WorkspaceRestoreResultSchema = createRuntimeIpcResultSchema(
  WorkspaceRestoreDataSchema,
  IPC_CHANNELS.recovery.workspaceRestore,
);

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

export const MemoryCandidateListResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateListDataSchema,
  IPC_CHANNELS.memory.candidateList,
);

export const MemoryCandidateAcceptResultSchema = createRuntimeIpcResultSchema(
  MemoryCandidateAcceptDataSchema,
  IPC_CHANNELS.memory.candidateAccept,
);

export const MemoryCandidateResultSchema = createRuntimeIpcResultSchema(MemoryCandidateDataSchema);

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

export const MemoryResultSchema = createRuntimeIpcResultSchema(MemoryDataSchema);

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

export const ProjectListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.project.list,
  ProjectListPayloadSchema,
);

export const ProjectUseExistingRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.project.useExisting,
  ProjectUseExistingPayloadSchema,
);

export const ProjectOpenRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.project.open,
  ProjectOpenPayloadSchema,
);

export const ProjectRemoveRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.project.remove,
  ProjectRemovePayloadSchema,
);

export const WorkspaceFilesListRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.workspace.files.list,
  WorkspaceFilesListPayloadSchema,
);

export const WorkspaceFileOpenRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.workspace.files.open,
  WorkspaceFileOpenPayloadSchema,
);

export const ProjectListResultSchema = createRuntimeIpcResultSchema(
  ProjectListDataSchema,
  IPC_CHANNELS.project.list,
);

export const ProjectUseExistingResultSchema = createRuntimeIpcResultSchema(
  ProjectUseExistingDataSchema,
  IPC_CHANNELS.project.useExisting,
);

export const ProjectOpenResultSchema = createRuntimeIpcResultSchema(
  ProjectOpenDataSchema,
  IPC_CHANNELS.project.open,
);

export const ProjectRemoveResultSchema = createRuntimeIpcResultSchema(
  ProjectRemoveDataSchema,
  IPC_CHANNELS.project.remove,
);

export const WorkspaceFilesListResultSchema = createRuntimeIpcResultSchema(
  WorkspaceFilesListDataSchema,
  IPC_CHANNELS.workspace.files.list,
);

export const WorkspaceFileOpenResultSchema = createRuntimeIpcResultSchema(
  WorkspaceFileOpenDataSchema,
  IPC_CHANNELS.workspace.files.open,
);

export type ProviderListPayload = z.infer<typeof ProviderListPayloadSchema>;
export type ProviderListData = z.infer<typeof ProviderListDataSchema>;
export type ProviderUpdatePayload = z.infer<typeof ProviderUpdatePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof ProviderDeleteApiKeyPayloadSchema>;
export type ProviderEmptyData = z.infer<typeof ProviderEmptyDataSchema>;
export type SettingsGetPayload = z.infer<typeof SettingsGetPayloadSchema>;
export type SettingsUpdatePayload = z.infer<typeof SettingsUpdatePayloadSchema>;
export type SettingsData = z.infer<typeof SettingsDataSchema>;
export type CommandSuggestionsPayload = z.infer<typeof CommandSuggestionsPayloadSchema>;
export type CommandSuggestionsData = z.infer<typeof CommandSuggestionsDataSchema>;
export type SessionMessageSendPayload = z.infer<typeof SessionMessageSendPayloadSchema>;
export type SessionMessageSendData = z.infer<typeof SessionMessageSendDataSchema>;
export type SessionMessageCancelPayload = z.infer<typeof SessionMessageCancelPayloadSchema>;
export type SessionMessageCancelData = z.infer<typeof SessionMessageCancelDataSchema>;
export type SessionBranchDraftIntent = z.infer<typeof SessionBranchDraftIntentSchema>;
export type SessionBranchDraftPayload = z.infer<typeof SessionBranchDraftPayloadSchema>;
export type SessionBranchDraft = z.infer<typeof SessionBranchDraftSchema>;
export type SessionBranchDraftCreatePayload = z.infer<typeof SessionBranchDraftCreatePayloadSchema>;
export type SessionBranchDraftCreateData = z.infer<typeof SessionBranchDraftCreateDataSchema>;
export type SessionBranchDraftCancelPayload = z.infer<typeof SessionBranchDraftCancelPayloadSchema>;
export type SessionBranchDraftCancelData = z.infer<typeof SessionBranchDraftCancelDataSchema>;
export type SessionMessageListPayload = z.infer<typeof SessionMessageListPayloadSchema>;
export type SessionMessageListData = z.infer<typeof SessionMessageListDataSchema>;
export type SessionTimelineListPayload = z.infer<typeof SessionTimelineListPayloadSchema>;
export type SessionTimelineListData = z.infer<typeof SessionTimelineListDataSchema>;
export type SessionCreatePayload = z.infer<typeof SessionCreatePayloadSchema>;
export type SessionCreateData = z.infer<typeof SessionCreateDataSchema>;
export type SessionListPayload = z.infer<typeof SessionListPayloadSchema>;
export type SessionListData = z.infer<typeof SessionListDataSchema>;
export type RunStartPayload = z.infer<typeof RunStartPayloadSchema>;
export type RunStartData = z.infer<typeof RunStartDataSchema>;
export type RunListBySessionPayload = z.infer<typeof RunListBySessionPayloadSchema>;
export type RunListBySessionData = z.infer<typeof RunListBySessionDataSchema>;
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
export type ToolExecutionGetPayload = z.infer<typeof ToolExecutionGetPayloadSchema>;
export type ToolExecutionGetData = z.infer<typeof ToolExecutionGetDataSchema>;
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
export type WorkspaceRestorePayload = z.infer<typeof WorkspaceRestorePayloadSchema>;
export type WorkspaceRestoreData = z.infer<typeof WorkspaceRestoreDataSchema>;
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
export type WorkspaceFilesListPayload = z.infer<typeof WorkspaceFilesListPayloadSchema>;
export type WorkspaceFilesListData = z.infer<typeof WorkspaceFilesListDataSchema>;
export type WorkspaceFileOpenPayload = z.infer<typeof WorkspaceFileOpenPayloadSchema>;
export type WorkspaceFileOpenData = z.infer<typeof WorkspaceFileOpenDataSchema>;
