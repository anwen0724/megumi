import type {
  SessionBranchDraftCancelData,
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreateData,
  SessionBranchDraftCreatePayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
  WorkspaceFileOpenData,
  WorkspaceFileOpenPayload,
} from '@megumi/shared/ipc';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = SessionMessageSendData;
export type SessionTimelineListPreloadPayload = SessionTimelineListPayload;
export type SessionTimelineListPreloadData = SessionTimelineListData;
export type SessionBranchDraftCreatePreloadPayload = SessionBranchDraftCreatePayload;
export type SessionBranchDraftCreatePreloadData = SessionBranchDraftCreateData;
export type SessionBranchDraftCancelPreloadPayload = SessionBranchDraftCancelPayload;
export type SessionBranchDraftCancelPreloadData = SessionBranchDraftCancelData;
export type WorkspaceFileOpenPreloadPayload = WorkspaceFileOpenPayload;
export type WorkspaceFileOpenPreloadData = WorkspaceFileOpenData;
