/*
 * Renderer-safe public Product Host Interface exports.
 * Host factory implementations remain internal to Product Composition.
 */
export * from './product-host-interface';
export type * from './workspace-host';
export type * from './chat-host';
export type * from './skill-host';
export type * from './settings-host';
export type * from './approval-host';
export type * from './artifact-host';
export type * from './plan-host';
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
  CommandSuggestionsPayloadSchema,
  SessionCreatePayloadSchema,
  SessionListPayloadSchema,
  SessionMessageListPayloadSchema,
  SessionTimelineListPayloadSchema,
  SessionHydrationGetPayloadSchema,
  SessionContextUsageGetPayloadSchema,
  SessionMessageSendPayloadSchema,
  SessionMessageCancelPayloadSchema,
  SessionBranchDraftCreatePayloadSchema,
  SessionBranchDraftCancelPayloadSchema,
  RunListBySessionPayloadSchema,
  RunEventsListPayloadSchema,
  ChatSendUserInputUiPayloadSchema,
  ChatCommandSuggestionsUiResultSchema,
  ChatCreateSessionUiResultSchema,
  ChatListSessionsUiResultSchema,
  ChatListMessagesUiResultSchema,
  ChatListTimelineUiResultSchema,
  ChatGetSessionHydrationUiResultSchema,
  ChatCancelUserInputUiPayloadSchema,
  ChatCreateBranchDraftUiPayloadSchema,
  ChatCancelBranchDraftUiPayloadSchema,
  ChatListRunsUiResultSchema,
  ChatListRunEventsUiResultSchema,
  ChatGetContextUsageUiResultSchema,
} from './chat-host';
export {
  SkillListPayloadSchema,
  SkillGetPayloadSchema,
  SkillEnablePayloadSchema,
  SkillDisablePayloadSchema,
  ListSkillsUiResponseSchema,
  GetSkillDetailUiResponseSchema,
  EnableSkillUiResponseSchema,
  DisableSkillUiResponseSchema,
} from './skill-host';
export {
  SettingsGetPayloadSchema,
  SettingsUpdatePayloadSchema,
  ProviderListPayloadSchema,
  ProviderUpdatePayloadSchema,
  ProviderDeletePayloadSchema,
  ProviderApiKeyPayloadSchema,
  ProviderDeleteApiKeyPayloadSchema,
  SettingsGetUiResultSchema,
  SettingsUpdateUiResultSchema,
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
export type { RuntimeContext, RuntimeEvent } from '../../coding-agent/events';
export type * from '../../coding-agent/events';
export type * from '../../coding-agent/projections/timeline';
export type * from '../../coding-agent/projections/workspace/workspace-change-footer-projector';
export type { PermissionMode } from '../../coding-agent/permissions';
export {
  RuntimeContextSchema,
  RuntimeErrorSchema,
  RuntimeEventSchema,
  RuntimeIdSchema,
  RuntimeResultMetaSchema,
  createRuntimeContext as buildRuntimeContext,
  createRuntimeDebugId as generateRuntimeDebugId,
  createRuntimeTraceId as generateRuntimeTraceId,
} from '../../coding-agent/events';
export { normalizeRuntimeError as normalizeHostRuntimeError } from '../../coding-agent/runtime-error';
export { reduceRuntimeTimelineEvent } from '../../coding-agent/projections/timeline';
