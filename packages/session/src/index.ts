/* Exposes stable Session facts, capability contracts, schemas, and creation entries. */
export type {
  Session,
  SessionFailure,
} from './session';
export {
  ASSISTANT_REPLY_REASON_CODES,
  ASSISTANT_REPLY_STATUSES,
  LegacyMessageProvenanceSchema,
  SESSION_MESSAGE_KINDS,
  SessionAssistantReplyMessageSchema,
  SessionAssistantReplyPayloadSchema,
  SessionMessageSchema,
  SessionModelResponseMessageSchema,
  SessionModelResponsePayloadSchema,
  SessionToolResultMessageSchema,
  SessionToolResultPayloadSchema,
  SessionUserMessagePayloadSchema,
  SessionUserMessageSchema,
  hasUserVisibleAssistantContent,
  isLegacySessionMessage,
  sessionMessageText,
} from './session-message';
export type {
  AssistantReplyReasonCode,
  AssistantReplyStatus,
  LegacyMessageProvenance,
  SessionAssistantReplyMessage,
  SessionMessage,
  SessionMessageContent,
  SessionMessageKind,
  SessionMessageWithAttachments,
  SessionModelResponseMessage,
  SessionToolResultMessage,
  UserMessage,
} from './session-message';
export {
  createSessionCatalog,
} from './session-catalog';
export type {
  ArchiveSessionRequest,
  ArchiveSessionResult,
  CreateSessionCatalogOptions,
  CreateSessionRequest,
  CreateSessionResult,
  GetSessionRequest,
  GetSessionResult,
  ListSessionsRequest,
  ListSessionsResult,
  SessionCatalog,
} from './session-catalog';
export {
  createSessionHistory,
} from './session-history';
export type {
  CreateSessionHistoryOptions,
  GetActiveConversationHistoryRequest,
  GetActiveConversationHistoryResult,
  GetActiveHistoryRequest,
  GetActiveHistoryResult,
  ListMessagesRequest,
  ListMessagesResult,
  ListUserMessagesByRunIdsRequest,
  ListUserMessagesByRunIdsResult,
  SaveAssistantReplyRequest,
  SaveAssistantReplyResult,
  SaveCompactionSummaryRequest,
  SaveCompactionSummaryResult,
  SaveMessageResult,
  SaveModelResponseRequest,
  SaveModelResponseResult,
  SaveToolResultMessageRequest,
  SaveToolResultMessageResult,
  SaveUserMessageRequest,
  SaveUserMessageResult,
  SessionHistory,
  SessionIdFactories,
} from './session-history';
export {
  createSessionEntryGraph,
} from './session-entry-graph';
export type {
  AppendSessionEntryRequest,
  AppendSessionEntryResult,
  GetActivePathRequest,
  GetActivePathResult,
  SessionCompactionSummary,
  SessionEntry,
  SessionEntryGraph,
  SessionHistoryItem,
  SwitchActiveEntryRequest,
  SwitchActiveEntryResult,
} from './session-entry-graph';
export {
  createSessionBranchDrafts,
} from './session-branch-drafts';
export type {
  CancelSessionBranchDraftRequest,
  CancelSessionBranchDraftResult,
  CommitSessionBranchDraftRequest,
  CommitSessionBranchDraftResult,
  CreateSessionBranchDraftRequest,
  CreateSessionBranchDraftResult,
  CreateSessionBranchDraftsOptions,
  ResolveSessionBranchDraftRequest,
  ResolveSessionBranchDraftResult,
  SessionBranchDraft,
  SessionBranchDrafts,
} from './session-branch-drafts';
export { createSessionAttachmentReader } from './session-attachment';
export type {
  SessionAttachmentContent,
  SessionAttachmentContentStore,
  SessionAttachmentFileSystem,
  SessionAttachmentImport,
  SessionAttachmentReader,
  SessionFileReference,
  SessionImageImport,
  SessionMessageAttachment,
  SupportedSessionImageMediaType,
} from './session-attachment';
export type {
  SessionStore,
} from './session-store';
