/* Exposes stable Session facts, capability contracts, schemas, and creation entries. */
export type {
  Session,
  SessionFailure,
} from './session';
export {
  ASSISTANT_REPLY_REASON_CODES,
  ASSISTANT_REPLY_STATUSES,
  SessionAssistantContentListSchema,
  SessionAssistantContentSchema,
  SessionImageContentSchema,
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
  SessionTextContentSchema,
  SessionThinkingContentSchema,
  SessionToolCallSchema,
  SessionUserContentListSchema,
  SessionUserContentSchema,
  hasUserVisibleAssistantContent,
  isLegacySessionMessage,
  sessionMessageText,
} from './session-message';
export type {
  SessionAssistantContent,
  AssistantReplyReasonCode,
  AssistantReplyStatus,
  SessionImageContent,
  LegacyMessageProvenance,
  SessionAssistantReplyMessage,
  SessionMessage,
  SessionMessageContent,
  SessionMessageKind,
  SessionMessageWithAttachments,
  SessionModelResponseMessage,
  SessionToolResultMessage,
  SessionTextContent,
  SessionThinkingContent,
  SessionToolCall,
  SessionUserContent,
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
  GetActiveHistoryRequest,
  GetActiveHistoryResult,
  ListMessagesRequest,
  ListMessagesResult,
  ListUserMessagesByRunIdsRequest,
  ListUserMessagesByRunIdsResult,
  SaveAssistantReplyRequest,
  SaveAssistantReplyResult,
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
  SESSION_COMPACTION_STATUSES,
  SESSION_COMPACTION_TRIGGERS,
  createSessionCompactionLifecycle,
} from './session-compaction';
export type {
  BeginCompactionRequest,
  BeginCompactionResult,
  CompleteCompactionRequest,
  CompleteCompactionResult,
  CreateSessionCompactionLifecycleOptions,
  EndCompactionRequest,
  EndCompactionResult,
  InterruptRunningCompactionsRequest,
  InterruptRunningCompactionsResult,
  SessionCompactionError,
  SessionCompactionLifecycle,
  SessionCompactionRecord,
  SessionCompactionStatus,
  SessionCompactionTrigger,
} from './session-compaction';
export { createSessionConversationReader } from './session-conversation';
export type {
  GetActiveConversationHistoryRequest,
  GetActiveConversationHistoryResult,
  GetCommittedBranchRequest,
  GetCommittedBranchResult,
  SessionBranchConversationItem,
  SessionCompactionConversationItem,
  SessionConversationItem,
  SessionConversationReader,
  SessionMessageConversationItem,
} from './session-conversation';
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
