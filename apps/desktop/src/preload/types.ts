import type {
  ChatCancelBranchDraftUiResult,
  ChatCreateBranchDraftUiResult,
  ChatGetContextUsageUiResult,
  ChatListTimelineUiResult,
  ChatSendUserInputUiResult,
  WorkspaceOpenFileUiResult,
} from '@megumi/coding-agent/host-interface';
import type {
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
  SessionMessageSendPayload,
  SessionContextUsageGetPayload,
  SessionTimelineListPayload,
  WorkspaceFileOpenPayload,
} from '../main/ipc/schemas';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = ChatSendUserInputUiResult;
export type SessionTimelineListPreloadPayload = SessionTimelineListPayload;
export type SessionTimelineListPreloadData = ChatListTimelineUiResult;
export type SessionContextUsageGetPreloadPayload = SessionContextUsageGetPayload;
export type SessionContextUsageGetPreloadData = ChatGetContextUsageUiResult;
export type SessionBranchDraftCreatePreloadPayload = SessionBranchDraftCreatePayload;
export type SessionBranchDraftCreatePreloadData = Pick<ChatCreateBranchDraftUiResult, 'branchDraft'>;
export type SessionBranchDraftCancelPreloadPayload = SessionBranchDraftCancelPayload;
export type SessionBranchDraftCancelPreloadData = Omit<ChatCancelBranchDraftUiResult, 'events'>;
export type WorkspaceFileOpenPreloadPayload = WorkspaceFileOpenPayload;
export type WorkspaceFileOpenPreloadData = WorkspaceOpenFileUiResult;
