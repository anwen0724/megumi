/* Runtime schemas for Product Host request and serializable result payloads. */
import { z } from 'zod';

export const EmptyHostPayloadSchema = z.object({}).strict();
const IsoDateTimeSchema = z.string().datetime();

export const CommandSuggestionsPayloadSchema = z.object({ draft_input: z.string(), workspaceId: z.string().min(1).optional() }).strict();
export const SkillListPayloadSchema = z.object({ workspaceId: z.string().min(1).optional() }).strict();
export const SkillGetPayloadSchema = z.object({ skillId: z.string().min(1), workspaceId: z.string().min(1).optional() }).strict();
export const SkillEnablePayloadSchema = SkillGetPayloadSchema;
export const SkillDisablePayloadSchema = SkillGetPayloadSchema.extend({ reason: z.string().optional() });

export const SessionCreatePayloadSchema = z.object({ projectId: z.string().min(1), title: z.string().min(1).optional() }).strict();
export const SessionMessageListPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const SessionTimelineListPayloadSchema = z.object({ projectId: z.string().min(1), sessionId: z.string().min(1) }).strict();
export const SessionContextUsageGetPayloadSchema = z.object({
  sessionId: z.string().min(1), projectId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
}).strict();
export const SessionMessageSendPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  text: z.string(),
  clientMessageId: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema.optional(),
  modelSelection: z.object({ provider_id: z.string().min(1), model_id: z.string().min(1) }).strict(),
  permissionMode: z.enum(['default', 'accept_edits', 'plan', 'auto']).optional(),
  permissionSource: z.string().optional(),
}).strict();
export const SessionMessageCancelPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
export const SessionBranchDraftCreatePayloadSchema = z.object({
  sessionId: z.string().min(1), messageId: z.string().min(1), intent: z.enum(['branch', 'rerun']), createdAt: IsoDateTimeSchema,
}).strict();
export const SessionBranchDraftCancelPayloadSchema = z.object({
  sessionId: z.string().min(1), branchMarkerId: z.string().min(1), createdAt: IsoDateTimeSchema,
}).strict();
export const RunListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const RunEventsListPayloadSchema = z.object({ runId: z.string().min(1) }).strict();

const ChatSessionSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), status: z.enum(['active', 'archived']), createdAt: z.string(), updatedAt: z.string(),
}).strict();
export const ChatSendUserInputUiPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_run'), session: ChatSessionSchema, requestId: z.string(), userMessageId: z.string(),
    run: z.object({ runId: z.string(), sessionId: z.string(), status: z.string(), createdAt: z.string(), completedAt: z.string().optional() }).strict(),
  }).strict(),
  z.object({ type: z.literal('host_interaction_request'), session: ChatSessionSchema.optional(), requestId: z.string(), request: z.object({ kind: z.string() }).passthrough() }).strict(),
  z.object({ type: z.literal('completed'), session: ChatSessionSchema.optional(), requestId: z.string(), message: z.string().optional() }).strict(),
  z.object({ type: z.literal('error'), session: ChatSessionSchema.optional(), requestId: z.string(), message: z.string() }).strict(),
]);

export const SettingsUpdatePayloadSchema = z.record(z.string(), z.unknown());
export const ProviderUpdatePayloadSchema = z.object({
  providerId: z.string().min(1), enabled: z.boolean().optional(), protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
  displayName: z.string().min(1).optional(), baseUrl: z.string().url().optional(), modelIds: z.array(z.string().min(1)).optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
}).strict();
export const ProviderDeletePayloadSchema = z.object({ providerId: z.string().min(1) }).strict();
export const ProviderApiKeyPayloadSchema = z.object({ providerId: z.string().min(1), apiKey: z.string().min(1) }).strict();
export const ProviderDeleteApiKeyPayloadSchema = ProviderDeletePayloadSchema;

export const ApprovalResolvePayloadSchema = z.object({
  approvalRequestId: z.string().min(1), decision: z.enum(['approved', 'denied']), scope: z.enum(['once', 'session']),
  reason: z.string().min(1).optional(), decidedAt: IsoDateTimeSchema,
}).strict();
export const ProjectOpenPayloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export const ProjectRemovePayloadSchema = ProjectOpenPayloadSchema;
export const WorkspaceFilesListPayloadSchema = z.object({ projectId: z.string().min(1), directoryPath: z.string() }).strict();
export const WorkspaceFileOpenPayloadSchema = z.object({ projectId: z.string().min(1), filePath: z.string().min(1) }).strict();

export const ArtifactListByRunPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
export const ArtifactListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const ArtifactGetPayloadSchema = z.object({ artifactId: z.string().min(1) }).strict();
export const ArtifactVersionGetPayloadSchema = z.object({ artifactVersionId: z.string().min(1) }).strict();
export const ArtifactVersionCreatePayloadSchema = z.object({
  artifactId: z.string().min(1), contentType: z.string().min(1), contentFormat: z.string().min(1), text: z.string(),
  textPreview: z.string(), changeSummary: z.string().min(1).optional(), createdByRunId: z.string().min(1),
  createdByStepId: z.string().min(1).optional(), createdAt: IsoDateTimeSchema, metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const ArtifactStatusUpdatePayloadSchema = z.object({
  artifactId: z.string().min(1), status: z.enum(['draft', 'active', 'superseded', 'archived', 'failed', 'deleted']), updatedAt: IsoDateTimeSchema,
}).strict();
export const ArtifactReferencePayloadSchema = z.object({
  artifactId: z.string().min(1), artifactVersionId: z.string().min(1).optional(),
  referencedByKind: z.enum(['run', 'step', 'artifact', 'message']), referencedById: z.string().min(1),
  createdAt: IsoDateTimeSchema, metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
