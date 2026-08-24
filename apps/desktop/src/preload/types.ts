import type {
  CancelBranchDraftResult,
  CreateBranchDraftResult,
  GetContextUsageResult,
  ReadSessionResult,
  ReadCommittedRunResult,
  SendUserInputPayload,
  DisableSkillUiResponse,
  DeleteSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  RefreshSkillsUiResponse,
  WorkspaceOpenFileUiResult,
  DiscoveryDailyEnsureResult,
  DiscoveryHomeUiResult,
  DiscoveryInterestUiDto,
  DiscoveryRecommendationSearchUiResult,
  DiscoveryRecommendationUiDto,
  DiscoverySessionParticipationUiDto,
  DiscoveryConfigurationUiDto,
  BrowserSourceConnectionView,
  BrowserSourcePairingView,
} from '@megumi/product/host';
import type {
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
  SessionReadPayload,
  CommittedRunReadPayload,
  SessionMessageSendPayload,
  SessionContextUsageGetPayload,
  SkillDisablePayload,
  SkillDeletePayload,
  SkillEnablePayload,
  SkillGetPayload,
  SkillListPayload,
  SkillRefreshPayload,
  WorkspaceFileOpenPayload,
  DiscoveryDailyEnsurePayload,
  DiscoveryHomePayload,
  DiscoveryInterestChangePayload,
  DiscoveryRecommendationSearchPayload,
  DiscoveryRecommendationStatePayload,
  DiscoverySessionParticipationPayload,
  DiscoveryConfigurationGetPayload,
  DiscoveryConfigurationUpdatePayload,
} from '../main/ipc/schemas';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = SendUserInputPayload;
export type SessionReadPreloadPayload = SessionReadPayload;
export type SessionReadPreloadData = ReadSessionResult;
export type CommittedRunReadPreloadPayload = CommittedRunReadPayload;
export type CommittedRunReadPreloadData = ReadCommittedRunResult;
export type SessionContextUsageGetPreloadPayload = SessionContextUsageGetPayload;
export type SessionContextUsageGetPreloadData = GetContextUsageResult;
export type SessionBranchDraftCreatePreloadPayload = SessionBranchDraftCreatePayload;
export type SessionBranchDraftCreatePreloadData = CreateBranchDraftResult['payload'];
export type SessionBranchDraftCancelPreloadPayload = SessionBranchDraftCancelPayload;
export type SessionBranchDraftCancelPreloadData = CancelBranchDraftResult['payload'];
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
export type SkillDeletePreloadPayload = SkillDeletePayload;
export type SkillDeletePreloadData = DeleteSkillUiResponse;
export type SkillRefreshPreloadPayload = SkillRefreshPayload;
export type SkillRefreshPreloadData = RefreshSkillsUiResponse;
export type DiscoveryInterestChangePreloadPayload = DiscoveryInterestChangePayload;
export type DiscoveryConfigurationGetPreloadPayload = DiscoveryConfigurationGetPayload;
export type DiscoveryConfigurationGetPreloadData = DiscoveryConfigurationUiDto;
export type DiscoveryConfigurationUpdatePreloadPayload = DiscoveryConfigurationUpdatePayload;
export type DiscoveryConfigurationUpdatePreloadData = DiscoveryConfigurationUiDto;
export type BrowserSourceConnectionPreloadData = BrowserSourceConnectionView;
export type BrowserSourcePairingPreloadData = BrowserSourcePairingView;
export type DiscoveryInterestChangePreloadData = DiscoveryInterestUiDto;
export type DiscoverySessionParticipationPreloadPayload = DiscoverySessionParticipationPayload;
export type DiscoverySessionParticipationPreloadData = DiscoverySessionParticipationUiDto;
export type DiscoveryDailyEnsurePreloadPayload = DiscoveryDailyEnsurePayload;
export type DiscoveryDailyEnsurePreloadData = DiscoveryDailyEnsureResult;
export type DiscoveryHomePreloadPayload = DiscoveryHomePayload;
export type DiscoveryHomePreloadData = DiscoveryHomeUiResult;
export type DiscoveryRecommendationSearchPreloadPayload = DiscoveryRecommendationSearchPayload;
export type DiscoveryRecommendationSearchPreloadData = DiscoveryRecommendationSearchUiResult;
export type DiscoveryRecommendationStatePreloadPayload = DiscoveryRecommendationStatePayload;
export type DiscoveryRecommendationStatePreloadData = DiscoveryRecommendationUiDto;
