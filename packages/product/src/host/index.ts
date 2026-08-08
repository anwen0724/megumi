/*
 * Renderer-safe public Product Host Interface exports.
 * Host factory implementations remain internal to Product Composition.
 */
import type { AnyEvent } from '@megumi/events';
import { createRuntimeTimeline, reduceRuntimeTimeline } from '@megumi/projections';

export {
  IPC_ERROR_CODES,
  IpcErrorCodeSchema,
  IpcErrorSchema,
  normalizeIpcError,
  sanitizeIpcError,
} from './ipc-error';
export type {
  IpcError,
  IpcErrorCode,
} from './ipc-error';
export { EventSchema as RuntimeEventSchema } from '@megumi/events';
export { redactHostRuntimeValue } from './runtime-redaction';
export type { AnyEvent } from '@megumi/events';
export { TimelineMessageSchema } from '@megumi/projections';
export type {
  AnswerTextBlock,
  AssistantTextItem,
  BranchSeparatorBlock,
  CancelledActivityItem,
  CompactionActivityItem,
  ErrorActivityItem,
  PlanActivityItem,
  ProcessDisclosureBlock,
  ProcessDisclosureItem,
  RecoveryActivityItem,
  RetryActivityItem,
  ThinkingItem,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
  ToolActivityItem,
  UserTimelineBlock,
  WorkspaceChangeFooterFile,
  WorkspaceChangeFooterFact,
} from '@megumi/projections';

export function reduceRuntimeTimelineEvent(
  messages: import('@megumi/projections').TimelineMessage[],
  event: AnyEvent,
): import('@megumi/projections').TimelineMessage[] {
  return reduceRuntimeTimeline({
    timeline: createRuntimeTimeline({ messages }),
    event,
  }).messages;
}


export * from './product-host';
export type {
  WorkspaceFileEntryUiDto,
  WorkspaceListFilesUiResult,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenFileUiResult,
  WorkspaceOpenProjectUiResult,
  WorkspaceProjectUiDto,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiResult,
} from './workspace-host';
export type { WorkspaceHost } from './workspace-host';
export type { DirectoryPicker, DirectoryPickerResult } from './capabilities/directory-picker';
export type { FileOpener, FileOpenResult } from './capabilities/file-opener';
export type {
  CancelBranchDraftResult,
  CancelUserInputResult,
  CancelUserInputPayload,
  CreateBranchDraftResult,
  CreateSessionResult,
  GetInputSuggestionsResult,
  GetContextUsageResult,
  GetSessionHydrationResult,
  ReadSessionRequest,
  ReadSessionResult,
  ReadCommittedRunRequest,
  ReadCommittedRunResult,
  SessionHost,
  ListUserMessagesByRunIdsResult,
  ListRunEventsResult,
  ListRunsResult,
  ListSessionsResult,
  ListSessionTimelineResult,
  RunDto,
  SendUserInputPayload,
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
} from './session-host';
export type { AttachmentPicker } from './capabilities/attachment-picker';
export type { LocalFileAvailability } from './capabilities/local-file-availability';
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
} from './skill-host';
export type {
  AppLanguage,
  AppThemeName,
  EmptyUiResult,
  ModelCapabilitiesUiDto,
  ModelSupportLevelUi,
  ProviderModelSettingsUiDto,
  ProviderCatalogUiDto,
  ProviderListUiResult,
  ProviderPublicStatusUiDto,
  PermissionRuleEffectUi,
  PermissionRuleUiDto,
  PermissionRuleChangeUi,
  PermissionRuleCatalogUiDto,
  SettingsCompleteSetupUiResult,
  SettingsCompleteSetupPayload,
  SettingsData,
  SettingsGetPayload,
  SettingsGetUiResult,
  SettingsUiResolved,
  SettingsUpdatePayload,
  SettingsUpdateUiResult,
} from './settings-host';
export type { SettingsHost } from './settings-host';
export type {
  ApprovalHost,
  ApprovalHostResult,
  ApprovalResolvePayload,
} from './approval-host';
export type {
  ArtifactGetData,
  ArtifactHost,
  ArtifactListData,
  ArtifactCreateVersionPayload,
  ArtifactReferencePayload,
  ArtifactReferenceData,
  ArtifactStatusUpdatePayload,
  ArtifactStatusUpdateData,
  ArtifactVersionCreateData,
  ArtifactVersionGetData,
} from './artifact-host';
export type { ObservabilityHost } from './observability-host';
export type { DiagnosticBundleSaver } from './capabilities/diagnostic-bundle-saver';
export type {
  DiagnosticBundleDto,
  DiagnosticBundleFileDto,
  ObservabilityAttributesUiDto,
  ObservabilityExportResult,
  ObservabilityGetRunTraceUiResult,
  ObservabilityListRunTracesUiResult,
  ObservabilityRunTraceDetailUiDto,
  ObservabilityRunTraceSummaryUiDto,
} from './observability-host';
export { ObservabilityListPayloadSchema, ObservabilityRunPayloadSchema, ObservabilityQueryResultSchema } from './observability-host';
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
} from './workspace-host';
export {
  InputSuggestionsPayloadSchema,
  SessionCreatePayloadSchema,
  SessionListPayloadSchema,
  SessionMessageListPayloadSchema,
  SessionReadPayloadSchema,
  CommittedRunReadPayloadSchema,
  SessionTimelineListPayloadSchema,
  SessionHydrationGetPayloadSchema,
  SessionContextUsageGetPayloadSchema,
  SessionMessageSendPayloadSchema,
  SessionMessageCancelPayloadSchema,
  SessionBranchDraftCreatePayloadSchema,
  SessionBranchDraftCancelPayloadSchema,
  RunListBySessionPayloadSchema,
  RunEventsListPayloadSchema,
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
  ListUserMessagesByRunIdsResultSchema,
  ListSessionTimelineResultSchema,
  GetSessionHydrationResultSchema,
  CancelUserInputPayloadSchema,
  CreateBranchDraftPayloadSchema,
  CancelBranchDraftPayloadSchema,
  ListRunsResultSchema,
  ListRunEventsResultSchema,
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
} from './session-host';
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
} from './skill-host';
export {
  SettingsGetPayloadSchema,
  SettingsUpdatePayloadSchema,
  SettingsCompleteSetupPayloadSchema,
  ProviderListPayloadSchema,
  ProviderUpdatePayloadSchema,
  ProviderDeletePayloadSchema,
  ProviderApiKeyPayloadSchema,
  ProviderDeleteApiKeyPayloadSchema,
  SettingsGetUiResultSchema,
  SettingsUpdateUiResultSchema,
  SettingsCompleteSetupUiResultSchema,
  ProviderListUiResultSchema,
  EmptyUiResultSchema,
} from './settings-host';
export { ApprovalResolvePayloadSchema, ApprovalResolveResultSchema } from './approval-host';
export {
  ArtifactListByRunPayloadSchema,
  ArtifactListBySessionPayloadSchema,
  ArtifactGetPayloadSchema,
  ArtifactVersionGetPayloadSchema,
  ArtifactVersionCreatePayloadSchema,
  ArtifactStatusUpdatePayloadSchema,
  ArtifactReferencePayloadSchema,
  ArtifactListDataSchema,
  ArtifactGetDataSchema,
  ArtifactVersionGetDataSchema,
  ArtifactVersionCreateDataSchema,
  ArtifactStatusUpdateDataSchema,
  ArtifactReferenceDataSchema,
} from './artifact-host';
