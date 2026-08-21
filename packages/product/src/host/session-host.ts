/* Defines the stable, host-neutral Session operations exposed by Product. */
import { EventSchema } from '@megumi/events';
import { z } from 'zod';
import { DOCUMENT_INPUT_POLICY, IMAGE_INPUT_POLICY } from '@megumi/input';

export interface SessionHost {
  createSession(request: CreateSessionRequest): Promise<CreateSessionResult>;
  listSessions(request?: ListSessionsRequest): Promise<ListSessionsResult>;
  listUserMessagesByExecutionIds(request: ListUserMessagesByExecutionIdsRequest): Promise<ListUserMessagesByExecutionIdsResult>;
  /** Returns durable conversation facts plus current-process runtime facts. */
  readSession(request: ReadSessionRequest): Promise<ReadSessionResult>;
  /** Returns committed facts used to reconcile one Run after its terminal event. */
  readCommittedRun(request: ReadCommittedRunRequest): Promise<ReadCommittedRunResult>;
  /** Submits one user input through Input, Session, and the Discovery Agent in that order. */
  sendUserInput(request: SendUserInputRequest): Promise<SendUserInputResult>;
  cancelUserInput(request: CancelUserInputRequest): Promise<CancelUserInputResult>;
  createBranchDraft(request: CreateBranchDraftRequest): CreateBranchDraftResult;
  cancelBranchDraft(request: CancelBranchDraftRequest): CancelBranchDraftResult;
  getInputSuggestions(request: GetInputSuggestionsRequest): Promise<GetInputSuggestionsResult>;
  getContextUsage(request: GetContextUsageRequest): Promise<GetContextUsageResult>;
  getInputCapabilities(): InputCapabilitiesResult;
  selectImages(): Promise<SelectImagesResult>;
  selectDocuments(): Promise<SelectDocumentsResult>;
  readClipboardImage(): Promise<SelectImagesResult>;
  readAttachmentImage(request: ReadAttachmentImageRequest): Promise<ReadAttachmentImageResult>;
  getAttachmentFileStatus(request: GetAttachmentFileStatusRequest): Promise<GetAttachmentFileStatusResult>;
}

export interface CommandInputSuggestion {
  readonly kind: 'command';
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly match: {
    readonly field: 'name' | 'alias';
    readonly value: string;
    readonly prefix: string;
  };
  readonly replacementInput: string;
}

export interface SkillInputSuggestion {
  readonly kind: 'skill';
  readonly name: string;
  readonly description: string;
  readonly sourceLabel?: string;
  readonly match: {
    readonly field: 'name';
    readonly value: string;
    readonly prefix: string;
  };
  readonly replacementInput: string;
  readonly selection: {
    readonly type: 'skill';
    readonly name: string;
    readonly skillPath: string;
  };
}

export type InputSuggestionQueryItem = CommandInputSuggestion | SkillInputSuggestion;

export interface InputSuggestionGroup {
  readonly id: 'commands' | 'skills';
  readonly label: string;
  readonly items: readonly InputSuggestionQueryItem[];
}

export type InputSuggestionQueryResult =
  | { readonly type: 'inactive' }
  | {
      readonly type: 'suggestions';
      readonly draftInput: string;
      readonly queryPrefix: string;
      readonly groups: readonly InputSuggestionGroup[];
    };

const IsoDateTimeSchema = z.string().datetime();
export const InputSuggestionsPayloadSchema = z.object({
  draftInput: z.string(), workspaceId: z.string().min(1).optional(),
}).strict();
export const SessionCreatePayloadSchema = z.object({
  projectId: z.string().min(1), title: z.string().min(1).optional(),
}).strict();
export const SessionListPayloadSchema = z.object({}).strict();
export const SessionMessageListPayloadSchema = z.object({
  executionIds: z.array(z.string().min(1)).min(1).max(200),
}).strict();
export const SessionReadPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const CommittedRunReadPayloadSchema = z.object({
  sessionId: z.string().min(1),
  executionId: z.string().min(1),
}).strict();
export const SessionContextUsageGetPayloadSchema = z.object({
  sessionId: z.string().min(1),
  modelSelection: z.object({ provider_id: z.string().min(1), model_id: z.string().min(1) }).strict(),
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
export const SessionMessageCancelPayloadSchema = z.object({ executionId: z.string().min(1) }).strict();
export const SessionBranchDraftCreatePayloadSchema = z.object({
  sessionId: z.string().min(1), messageId: z.string().min(1),
}).strict();
export const SessionBranchDraftCancelPayloadSchema = z.object({
  sessionId: z.string().min(1), branchMarkerId: z.string().min(1),
}).strict();
export const InputCapabilitiesPayloadSchema = z.object({}).strict();
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

const SelectedImageDtoSchema = z.object({
  draftAttachmentId: z.string().min(1),
  name: z.string().min(1),
  declaredMimeType: z.string().optional(),
  referenceId: z.string().min(1),
  previewDataUrl: z.string(),
}).strict();
export type SelectedImageDto = z.infer<typeof SelectedImageDtoSchema>;
const SelectedDocumentDtoSchema = z.object({
  draftAttachmentId: z.string().min(1),
  name: z.string().min(1),
  declaredMimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  referenceId: z.string().min(1),
}).strict();
export type SelectedDocumentDto = z.infer<typeof SelectedDocumentDtoSchema>;
export type InputCapabilitiesResult = z.infer<typeof InputCapabilitiesResultSchema>;
export const InputCapabilitiesResultSchema = z.object({
  maxTextCharacters: z.number().int().positive(),
  allowedMediaTypes: z.array(z.string()),
  maxImageCount: z.number().int().positive(),
  maxImageBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
  allowedDocumentMediaTypes: z.array(z.string()),
  maxDocumentCount: z.number().int().positive(),
  maxDocumentBytes: z.number().int().positive(),
}).strict();
export const SelectImagesResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), images: z.array(SelectedImageDtoSchema) }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const SelectDocumentsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), documents: z.array(SelectedDocumentDtoSchema) }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ReadAttachmentImageResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), dataUrl: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const AttachmentFileStatusResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available') }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export type SelectImagesResult = z.infer<typeof SelectImagesResultSchema>;
export type SelectDocumentsResult = z.infer<typeof SelectDocumentsResultSchema>;
export type ReadAttachmentImageRequest = z.infer<typeof AttachmentImageReadPayloadSchema>;
export type ReadAttachmentImageResult = z.infer<typeof ReadAttachmentImageResultSchema>;
export type GetAttachmentFileStatusRequest = z.infer<typeof AttachmentFileStatusPayloadSchema>;
export type GetAttachmentFileStatusResult = z.infer<typeof AttachmentFileStatusResultSchema>;

export const SessionDtoSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), title: z.string(),
  status: z.enum(['active', 'archived']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const RunDtoSchema = z.object({
  executionId: z.string().min(1), sessionId: z.string().min(1),
  status: z.enum(['running', 'waiting', 'cancelling', 'completed', 'failed', 'cancelled']),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
}).strict();

const UsageDtoSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  cacheWrite1h: z.number().int().nonnegative().optional(),
  reasoning: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }).strict(),
}).strict();

const TextContentDtoSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  textSignature: z.string().optional(),
}).strict();
const ImageContentDtoSchema = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string().min(1),
}).strict();
const ThinkingContentDtoSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  thinkingSignature: z.string().optional(),
  redacted: z.boolean().optional(),
}).strict();
const ToolCallDtoSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  thoughtSignature: z.string().optional(),
}).strict();
const UserContentDtoSchema = z.discriminatedUnion('type', [TextContentDtoSchema, ImageContentDtoSchema]);
const AssistantContentDtoSchema = z.discriminatedUnion('type', [
  TextContentDtoSchema,
  ThinkingContentDtoSchema,
  ToolCallDtoSchema,
]);
const AttachmentDtoSchema = z.object({
  attachmentId: z.string().min(1),
  type: z.enum(['image', 'file']),
  name: z.string().optional(),
  mediaType: z.string().optional(),
  source: z.enum(['localFile', 'managed']),
  ordinal: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
}).strict();
const MessageBaseShape = {
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  executionId: z.string().min(1).optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
};
export const UserMessageDtoSchema = z.object({
  ...MessageBaseShape,
  kind: z.literal('user'),
  displayContent: z.array(UserContentDtoSchema),
  skillSelection: z.object({ name: z.string().min(1), skillPath: z.string().min(1) }).strict().optional(),
  attachments: z.array(AttachmentDtoSchema),
}).strict();
const ModelResponseDtoSchema = z.object({
  ...MessageBaseShape,
  kind: z.literal('modelResponse'),
  content: z.array(AssistantContentDtoSchema),
  outcomeStatus: z.enum(['completed', 'incomplete', 'failed']),
  reasonCode: z.string().optional(),
  stopReason: z.string().optional(),
  api: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  responseModel: z.string().optional(),
  responseId: z.string().optional(),
  usage: UsageDtoSchema.optional(),
  failure: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterMs: z.number().nonnegative().optional(),
  }).strict().optional(),
  errorMessage: z.string().optional(),
}).strict();
const ToolResultDtoSchema = z.object({
  ...MessageBaseShape,
  kind: z.literal('toolResult'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(['success', 'failure', 'permission_denied', 'user_rejected', 'cancelled']),
  content: z.array(UserContentDtoSchema),
  usage: UsageDtoSchema.optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
}).strict();
const AssistantReplyDtoSchema = z.object({
  ...MessageBaseShape,
  kind: z.literal('assistantReply'),
  status: z.enum(['completed', 'failed', 'cancelled']),
  content: z.array(AssistantContentDtoSchema),
  reasonCode: z.string().optional(),
  api: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  responseModel: z.string().optional(),
  responseId: z.string().optional(),
  usage: UsageDtoSchema.optional(),
  errorMessage: z.string().optional(),
}).strict();
export const SessionMessageDtoSchema = z.discriminatedUnion('kind', [
  UserMessageDtoSchema,
  ModelResponseDtoSchema,
  ToolResultDtoSchema,
  AssistantReplyDtoSchema,
]);
export const SessionMessageConversationItemDtoSchema = z.object({
  type: z.literal('message'),
  entryId: z.string().min(1),
  parentEntryId: z.string().min(1).optional(),
  message: SessionMessageDtoSchema,
}).strict();
const SessionCompactionConversationItemDtoSchema = z.object({
  type: z.literal('compaction'),
  compactionId: z.string().min(1),
  trigger: z.enum(['threshold', 'overflow', 'manual', 'legacy']),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  error: z.object({ code: z.string().optional(), message: z.string() }).strict().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
}).strict();
export const SessionBranchConversationItemDtoSchema = z.object({
  type: z.literal('branch'),
  branchId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  targetMessageId: z.string().min(1),
  createdAt: z.string(),
}).strict();
export const SessionConversationItemDtoSchema = z.discriminatedUnion('type', [
  SessionMessageConversationItemDtoSchema,
  SessionCompactionConversationItemDtoSchema,
  SessionBranchConversationItemDtoSchema,
]);
const WorkspaceChangedFileDtoSchema = z.object({
  changedFileId: z.string().min(1),
  workspacePath: z.string(),
  changeKind: z.string(),
}).strict();
export const WorkspaceChangeSummaryDtoSchema = z.object({
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  changeSetId: z.string().min(1),
  changedFileCount: z.number().int().nonnegative(),
  files: z.array(WorkspaceChangedFileDtoSchema),
  updatedAt: z.string(),
}).strict();
const SessionReadDiagnosticDtoSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  executionId: z.string().min(1).optional(),
}).strict();
const SessionRuntimeEventRangeDtoSchema = z.object({
  firstSequence: z.number().int().positive().optional(),
  lastSequence: z.number().int().positive().optional(),
  truncated: z.boolean(),
}).strict();
export const ReadSessionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    session: SessionDtoSchema,
    conversation: z.array(SessionConversationItemDtoSchema),
    activeRun: RunDtoSchema.optional(),
    runtimeEvents: z.array(EventSchema),
    eventRange: SessionRuntimeEventRangeDtoSchema,
    workspaceChanges: z.array(WorkspaceChangeSummaryDtoSchema),
    diagnostics: z.array(SessionReadDiagnosticDtoSchema),
  }).strict(),
  z.object({ status: z.literal('not_found'), sessionId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ReadCommittedRunResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    messages: z.array(SessionMessageConversationItemDtoSchema),
    workspaceChanges: z.array(WorkspaceChangeSummaryDtoSchema),
    diagnostics: z.array(SessionReadDiagnosticDtoSchema),
  }).strict(),
  z.object({ status: z.literal('not_found'), executionId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const SendUserInputPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_run'), session: SessionDtoSchema, requestId: z.string(), userMessageId: z.string(),
    userMessage: UserMessageDtoSchema,
    run: RunDtoSchema,
    branchCommit: z.object({
      branchMarkerId: z.string().min(1),
      branch: SessionBranchConversationItemDtoSchema,
    }).strict().optional(),
  }).strict(),
  z.object({
    type: z.literal('host_interaction_request'), session: SessionDtoSchema.optional(), requestId: z.string(),
    request: z.object({ kind: z.string() }).strict(),
  }).strict(),
  z.object({
    type: z.literal('completed'), session: SessionDtoSchema.optional(), requestId: z.string(), message: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('error'), session: SessionDtoSchema.optional(), requestId: z.string(), message: z.string(),
  }).strict(),
]);
const InputSuggestionItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'), name: z.string(), aliases: z.array(z.string()).optional(),
    description: z.string(), argumentHint: z.string().optional(),
    match: z.object({ field: z.enum(['name', 'alias']), value: z.string(), prefix: z.string() }).strict(),
    replacementInput: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('skill'), name: z.string(), description: z.string(), sourceLabel: z.string().optional(),
    match: z.object({ field: z.literal('name'), value: z.string(), prefix: z.string() }).strict(),
    replacementInput: z.string(),
    selection: z.object({ type: z.literal('skill'), name: z.string(), skillPath: z.string() }).strict(),
  }).strict(),
]);
const InputSuggestionGroupSchema = z.object({
  id: z.enum(['commands', 'skills']), label: z.string(), items: z.array(InputSuggestionItemSchema),
}).strict();

export const GetInputSuggestionsResultSchema = z.object({
  suggestions: z.discriminatedUnion('type', [
    z.object({ type: z.literal('inactive') }).strict(),
    z.object({
      type: z.literal('suggestions'), draftInput: z.string(), queryPrefix: z.string(),
      groups: z.array(InputSuggestionGroupSchema),
    }).strict(),
  ]),
}).strict();
export const CreateSessionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), session: SessionDtoSchema }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ListSessionsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), sessions: z.array(SessionDtoSchema) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ListUserMessagesByExecutionIdsResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    messages: z.array(z.object({
      id: z.string().min(1), sessionId: z.string().min(1), executionId: z.string().min(1).optional(),
      role: z.enum(['user', 'assistant', 'toolResult']), text: z.string(), createdAt: z.string().datetime(),
    }).strict()),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const CancelUserInputPayloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancellation_requested'), run: RunDtoSchema }).strict(),
  z.object({ status: z.literal('cancelling'), run: RunDtoSchema }).strict(),
  z.object({ status: z.literal('not_found'), executionId: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('not_cancellable'),
    run: RunDtoSchema,
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
export const CreateBranchDraftPayloadSchema = z.object({
  branchDraft: z.object({
    branchMarkerId: z.string().min(1), sessionId: z.string().min(1), sourceMessageId: z.string().min(1),
    createdAt: z.string().datetime(),
  }).strict(),
}).strict();
export const CancelBranchDraftPayloadSchema = z.object({
  cancelled: z.boolean(), reason: z.string().optional(),
}).strict();
export const GetContextUsageResultSchema = z.discriminatedUnion('status', [
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

/* Host-safe Session DTOs preserve facts without constructing UI Timeline blocks. */



export type SessionDto = z.infer<typeof SessionDtoSchema>;

export interface UserMessageSummaryDto {
  id: string;
  sessionId: string;
  executionId?: string;
  role: 'user' | 'assistant' | 'toolResult';
  text: string;
  createdAt: string;
}

export type RunDto = z.infer<typeof RunDtoSchema>;
export type UserMessageDto = z.infer<typeof UserMessageDtoSchema>;
export type SessionMessageDto = z.infer<typeof SessionMessageDtoSchema>;
export type SessionMessageConversationItemDto = z.infer<typeof SessionMessageConversationItemDtoSchema>;
export type SessionConversationItemDto = z.infer<typeof SessionConversationItemDtoSchema>;
export type SessionBranchConversationItemDto = z.infer<typeof SessionBranchConversationItemDtoSchema>;
export type WorkspaceChangeSummaryDto = z.infer<typeof WorkspaceChangeSummaryDtoSchema>;
export type SessionReadDiagnosticDto = z.infer<typeof SessionReadDiagnosticDtoSchema>;
export type SessionRuntimeEventRangeDto = z.infer<typeof SessionRuntimeEventRangeDtoSchema>;

export interface CreateSessionRequest {
  projectId: string;
  title?: string;
}
export type HostFailure = {
  code: string;
  message: string;
  retryable?: boolean;
};
export type CreateSessionResult =
  | { status: 'created'; session: SessionDto }
  | { status: 'failed'; failure: HostFailure };

export interface ListSessionsRequest {}
export type ListSessionsResult =
  | { status: 'ok'; sessions: SessionDto[] }
  | { status: 'failed'; failure: HostFailure };

export interface ListUserMessagesByExecutionIdsRequest { executionIds: string[] }
export type ListUserMessagesByExecutionIdsResult =
  | { status: 'ok'; messages: UserMessageSummaryDto[] }
  | { status: 'failed'; failure: HostFailure };

export type ReadSessionRequest = z.infer<typeof SessionReadPayloadSchema>;
export type ReadSessionResult = z.infer<typeof ReadSessionResultSchema>;
export type ReadCommittedRunRequest = z.infer<typeof CommittedRunReadPayloadSchema>;
export type ReadCommittedRunResult = z.infer<typeof ReadCommittedRunResultSchema>;


export interface SendUserInputRequest {
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
}
export type SendUserInputPayload =
  | {
      type: 'agent_run';
      session: SessionDto;
      requestId: string;
      userMessageId: string;
      userMessage: UserMessageDto;
      run: RunDto;
      branchCommit?: {
        branchMarkerId: string;
        branch: SessionBranchConversationItemDto;
      };
    }
  | {
      type: 'host_interaction_request';
      session?: SessionDto;
      requestId: string;
      request: { kind: string };
    }
  | {
      type: 'completed';
      session?: SessionDto;
      requestId: string;
      message?: string;
    }
  | {
      type: 'error';
      session?: SessionDto;
      requestId: string;
      message: string;
    };
export interface SendUserInputResult {
  payload: SendUserInputPayload;
}

export type PermissionMode = 'ask' | 'auto' | 'full_access';

export interface CancelUserInputRequest {
  executionId: string;
}
export type CancelUserInputPayload =
  | { status: 'cancellation_requested'; run: RunDto }
  | { status: 'cancelling'; run: RunDto }
  | { status: 'not_found'; executionId: string }
  | { status: 'not_cancellable'; run: RunDto; reason: 'already_terminal' | 'not_running' }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };
export interface CancelUserInputResult {
  payload: CancelUserInputPayload;
}

export interface CreateBranchDraftRequest {
  requestId: string;
  sessionId: string;
  messageId: string;
}
export interface CreateBranchDraftResult {
  payload: { branchDraft: {
    branchMarkerId: string;
    sessionId: string;
    sourceMessageId: string;
    createdAt: string;
  } };
}

export interface CancelBranchDraftRequest {
  requestId: string;
  sessionId: string;
  branchMarkerId: string;
}
export interface CancelBranchDraftResult {
  payload: {
    cancelled: boolean;
    reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found' | string;
  };
}

export interface GetInputSuggestionsRequest {
  draftInput: string;
  workspaceId?: string;
}
export interface GetInputSuggestionsResult {
  suggestions: InputSuggestionQueryResult;
}

export interface GetContextUsageRequest {
  sessionId: string;
  modelSelection: { provider_id: string; model_id: string };
}

export type ContextUsageDto = {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedPercent: number;
  autoCompactPercent: number;
  accuracy: 'provider_reported' | 'estimated';
};

export type GetContextUsageResult =
  | { status: 'available'; usage: ContextUsageDto }
  | { status: 'not_available' }
  | { status: 'failed'; failure: HostFailure };
