/*
 * Renderer-safe public Product Host Interface exports.
 * Concrete composition roots consume these contracts through the public entry.
 */
export { EventSchema as RuntimeEventSchema } from '@megumi/agent-runtime/events';
export { redactHostRuntimeValue } from './runtime-redaction';
export type { AnyEvent } from '@megumi/agent-runtime/events';

export * from './application-operations';
export * from './discovery/discovery-contracts';
export type {
  WorkspaceFileEntryUiDto,
  WorkspaceListFilesUiResult,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenFileUiResult,
  WorkspaceOpenProjectUiResult,
  WorkspaceProjectUiDto,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiResult,
} from './workspace/workspace-contracts';
export type { WorkspaceHost } from './workspace/workspace-contracts';
export type { DirectoryPicker, DirectoryPickerResult } from './platform/directory-picker';
export type { FileOpener, FileOpenResult } from './platform/file-opener';
export type {
  CancelBranchDraftResult,
  CancelUserInputResult,
  CancelUserInputPayload,
  CreateBranchDraftResult,
  CreateSessionResult,
  GetInputSuggestionsResult,
  GetContextUsageResult,
  ReadSessionRequest,
  ReadSessionResult,
  ReadCommittedRunRequest,
  ReadCommittedRunResult,
  SessionHost,
  ListUserMessagesByExecutionIdsResult,
  ListSessionsResult,
  RunDto,
  SendUserInputPayload,
  SendUserInputRequest,
  SendUserInputResult,
  SessionDto,
  SessionConversationItemDto,
  SessionMessageConversationItemDto,
  SessionMessageDto,
  SessionBranchConversationItemDto,
  UserMessageDto,
  WorkspaceChangeSummaryDto,
  SessionReadDiagnosticDto,
  SessionRuntimeEventRangeDto,
  UserMessageSummaryDto,
  InputSuggestionQueryItem,
  InputSuggestionQueryResult,
  PermissionMode,
  SelectedImageDto,
  SelectedDocumentDto,
  InputCapabilitiesResult,
  SelectImagesResult,
  SelectDocumentsResult,
  ReadAttachmentImageRequest,
  ReadAttachmentImageResult,
  GetAttachmentFileStatusRequest,
  GetAttachmentFileStatusResult,
} from './session-contracts';
export type { AttachmentPicker } from './platform/attachment-picker';
export type { LocalFileAvailability } from './platform/local-file-availability';
export type { ProductWorkspaceFileSystem } from './platform/workspace-file-system';
export type {
  DisableSkillUiResponse,
  DeleteSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  RefreshSkillsUiResponse,
  SkillDetailUiDto,
  SkillHost,
  SkillListUiItem,
} from './skill-contracts';

export type {
  ApprovalHost,
  ApprovalHostResult,
  ApprovalResolvePayload,
} from './approval-contracts';
export type { ObservabilityHost } from './observability/observability-contracts';
export type {
  VoiceHost,
  VoiceHostModelStatus,
  VoiceHostModelUpdateResult,
  VoiceHostMutationResult,
  VoiceHostSnapshot,
  VoiceSessionMutedPayload,
  VoiceSessionStartPayload,
  VoiceModelCapabilityPayload,
  VoiceHostModelCapabilityStatus,
} from './voice/voice-contracts';
export {
  VoiceEmptyPayloadSchema,
  VoiceModelStatusResultSchema,
  VoiceModelCapabilityPayloadSchema,
  VoiceModelCapabilityStatusSchema,
  VoiceModelUpdateResultSchema,
  VoiceHostMutationResultSchema,
  VoiceSessionMutedPayloadSchema,
  VoiceSessionStartPayloadSchema,
  VoiceSnapshotSchema,
} from './voice/voice-contracts';
export type { DiagnosticBundleSaver } from './platform/diagnostic-bundle-saver';
export type {
  DiagnosticBundleDto,
  DiagnosticBundleFileDto,
  ObservabilityContentCheckpointUiDto,
  ObservabilityCorrelationUiDto,
  ObservabilityDiagnosticErrorUiDto,
  ObservabilityEventUiDto,
  ObservabilityExportResult,
  ObservabilityGetContentResult,
  ObservabilityGetTraceResult,
  ObservabilityHealthResult,
  ObservabilityHealthUiDto,
  ObservabilityListResult,
  ObservabilityRebuildResult,
  ObservabilitySpanUiDto,
  ObservabilityTraceDetailUiDto,
  ObservabilityTraceSummaryUiDto,
} from './observability/observability-contracts';
export {
  ObservabilityContentPayloadSchema,
  ObservabilityCorrelationSchema,
  ObservabilityEmptyPayloadSchema,
  ObservabilityExportResultSchema,
  ObservabilityGetContentResultSchema,
  ObservabilityGetTraceResultSchema,
  ObservabilityHealthResultSchema,
  ObservabilityListPayloadSchema,
  ObservabilityListResultSchema,
  ObservabilityRebuildResultSchema,
  ObservabilityTracePayloadSchema,
} from './observability/observability-contracts';
export {
  WorkspaceListProjectsPayloadSchema,
  WorkspaceUseExistingProjectPayloadSchema,
  ProjectOpenPayloadSchema,
  ProjectRemovePayloadSchema,
  WorkspaceFilesListPayloadSchema,
  WorkspaceFileOpenPayloadSchema,
  WorkspaceListProjectsUiResultSchema,
  WorkspaceUseExistingProjectUiResultSchema,
  WorkspaceOpenProjectUiResultSchema,
  WorkspaceRemoveProjectUiResultSchema,
  WorkspaceListFilesUiResultSchema,
  WorkspaceOpenFileUiResultSchema,
} from './workspace/workspace-contracts';
export {
  InputSuggestionsPayloadSchema,
  SessionCreatePayloadSchema,
  SessionListPayloadSchema,
  SessionMessageListPayloadSchema,
  SessionReadPayloadSchema,
  CommittedRunReadPayloadSchema,
  SessionContextUsageGetPayloadSchema,
  SessionMessageSendPayloadSchema,
  SessionMessageCancelPayloadSchema,
  SessionBranchDraftCreatePayloadSchema,
  SessionBranchDraftCancelPayloadSchema,
  InputCapabilitiesPayloadSchema,
  ImageInputSelectPayloadSchema,
  DocumentInputSelectPayloadSchema,
  ImageInputClipboardReadPayloadSchema,
  AttachmentImageReadPayloadSchema,
  AttachmentFileStatusPayloadSchema,
  InputCapabilitiesResultSchema,
  SelectImagesResultSchema,
  SelectDocumentsResultSchema,
  ReadAttachmentImageResultSchema,
  AttachmentFileStatusResultSchema,
  SendUserInputPayloadSchema,
  GetInputSuggestionsResultSchema,
  CreateSessionResultSchema,
  ListSessionsResultSchema,
  ListUserMessagesByExecutionIdsResultSchema,
  CancelUserInputPayloadSchema,
  CreateBranchDraftPayloadSchema,
  CancelBranchDraftPayloadSchema,
  GetContextUsageResultSchema,
  ReadSessionResultSchema,
  ReadCommittedRunResultSchema,
  SessionDtoSchema,
  RunDtoSchema,
  UserMessageDtoSchema,
  SessionMessageDtoSchema,
  SessionMessageConversationItemDtoSchema,
  SessionConversationItemDtoSchema,
  SessionBranchConversationItemDtoSchema,
  WorkspaceChangeSummaryDtoSchema,
} from './session-contracts';
export {
  SkillListPayloadSchema,
  SkillGetPayloadSchema,
  SkillEnablePayloadSchema,
  SkillDisablePayloadSchema,
  SkillDeletePayloadSchema,
  SkillRefreshPayloadSchema,
  ListSkillsUiResponseSchema,
  GetSkillDetailUiResponseSchema,
  EnableSkillUiResponseSchema,
  DisableSkillUiResponseSchema,
  DeleteSkillUiResponseSchema,
  RefreshSkillsUiResponseSchema,
} from './skill-contracts';

export { ApprovalResolvePayloadSchema, ApprovalResolveResultSchema } from './approval-contracts';

export { ObservabilityTraceMeasurementsSchema } from './observability/observability-contracts';

export {
  SessionModelSelectionPayloadSchema,
  SessionModelSelectionResultSchema,
} from './session-contracts';
export type {
  SessionModelSelectionPayload,
  SessionModelSelectionResult,
} from './session-contracts';

export type { AppLanguage, AppThemeName } from './settings/settings-contracts';
