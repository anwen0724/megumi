import type {
  ChatCancelBranchDraftUiResult,
  ChatCreateBranchDraftUiResult,
  ChatGetSessionHydrationUiResult,
  ChatGetContextUsageUiResult,
  ChatListTimelineUiResult,
  ChatSendUserInputUiPayload,
  DisableSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  WorkspaceOpenFileUiResult,
} from '@megumi/product/host-interface';
import type {
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
  SessionHydrationGetPayload,
  SessionMessageSendPayload,
  SessionContextUsageGetPayload,
  SessionTimelineListPayload,
  SkillDisablePayload,
  SkillEnablePayload,
  SkillGetPayload,
  SkillListPayload,
  WorkspaceFileOpenPayload,
} from '../main/ipc/schemas';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = ChatSendUserInputUiPayload;
export type SessionTimelineListPreloadPayload = SessionTimelineListPayload;
export type SessionTimelineListPreloadData = ChatListTimelineUiResult;
export type SessionHydrationGetPreloadPayload = SessionHydrationGetPayload;
export type SessionHydrationGetPreloadData = ChatGetSessionHydrationUiResult;
export type SessionContextUsageGetPreloadPayload = SessionContextUsageGetPayload;
export type SessionContextUsageGetPreloadData = ChatGetContextUsageUiResult;
export type SessionBranchDraftCreatePreloadPayload = SessionBranchDraftCreatePayload;
export type SessionBranchDraftCreatePreloadData = ChatCreateBranchDraftUiResult['payload'];
export type SessionBranchDraftCancelPreloadPayload = SessionBranchDraftCancelPayload;
export type SessionBranchDraftCancelPreloadData = ChatCancelBranchDraftUiResult['payload'];
export type WorkspaceFileOpenPreloadPayload = WorkspaceFileOpenPayload;
export type WorkspaceFileOpenPreloadData = WorkspaceOpenFileUiResult;
export type SkillListPreloadPayload = SkillListPayload;
export type SkillListPreloadData = ListSkillsUiResponse;
export type SkillGetPreloadPayload = SkillGetPayload;
export type SkillGetPreloadData = GetSkillDetailUiResponse;
export type SkillEnablePreloadPayload = SkillEnablePayload;
export type SkillEnablePreloadData = EnableSkillUiResponse;
export type SkillDisablePreloadPayload = SkillDisablePayload;
export type SkillDisablePreloadData = DisableSkillUiResponse;
