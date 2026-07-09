import type {
  ChatCancelBranchDraftUiResult,
  ChatCreateBranchDraftUiResult,
  ChatGetContextUsageUiResult,
  ChatListTimelineUiResult,
  ChatSendUserInputUiResult,
  DisableSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  WorkspaceOpenFileUiResult,
} from '@megumi/coding-agent/host-interface';
import type {
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
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
export type SkillListPreloadPayload = SkillListPayload;
export type SkillListPreloadData = ListSkillsUiResponse;
export type SkillGetPreloadPayload = SkillGetPayload;
export type SkillGetPreloadData = GetSkillDetailUiResponse;
export type SkillEnablePreloadPayload = SkillEnablePayload;
export type SkillEnablePreloadData = EnableSkillUiResponse;
export type SkillDisablePreloadPayload = SkillDisablePayload;
export type SkillDisablePreloadData = DisableSkillUiResponse;
