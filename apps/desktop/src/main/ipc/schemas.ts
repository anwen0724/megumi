/* Desktop IPC combines Product Host payload schemas with transport envelopes. */
import { z } from 'zod';
import * as host from '@megumi/product-host/host';
import { createRuntimeIpcRequestSchema } from './contracts';
import { IPC_CHANNELS } from './channels';

export const InputSuggestionsRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.inputSuggestions, host.InputSuggestionsPayloadSchema);
export const SkillListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.list, host.SkillListPayloadSchema);
export const SkillGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.get, host.SkillGetPayloadSchema);
export const SkillEnableRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.enable, host.SkillEnablePayloadSchema);
export const SkillDisableRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.disable, host.SkillDisablePayloadSchema);
export const SkillDeleteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.delete, host.SkillDeletePayloadSchema);
export const SkillRefreshRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.skill.refresh, host.SkillRefreshPayloadSchema);
export const SessionCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionCreate, host.SessionCreatePayloadSchema);
export const SessionListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionList, host.SessionListPayloadSchema);
export const SessionMessageListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionMessageList, host.SessionMessageListPayloadSchema);
export const SessionReadRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionRead, host.SessionReadPayloadSchema);
export const CommittedRunReadRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.committedRunRead, host.CommittedRunReadPayloadSchema);
export const SessionMessageSendRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionMessageSend, host.SessionMessageSendPayloadSchema);
export const SessionMessageCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionMessageCancel, host.SessionMessageCancelPayloadSchema);
export const SessionContextUsageGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.sessionContextUsageGet, host.SessionContextUsageGetPayloadSchema);
export const InputCapabilitiesGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.inputCapabilitiesGet, host.InputCapabilitiesPayloadSchema);
export const ImageInputSelectRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.imageInputSelect, host.ImageInputSelectPayloadSchema);
export const DocumentInputSelectRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.documentInputSelect, host.DocumentInputSelectPayloadSchema);
export const ImageInputClipboardReadRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.imageInputClipboardRead, host.ImageInputClipboardReadPayloadSchema);
export const AttachmentImageReadRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.attachmentImageRead, host.AttachmentImageReadPayloadSchema);
export const AttachmentFileStatusRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.attachmentFileStatus, host.AttachmentFileStatusPayloadSchema);
export const SessionBranchDraftCreateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.branchDraftCreate, host.SessionBranchDraftCreatePayloadSchema);
export const SessionBranchDraftCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.session.branchDraftCancel, host.SessionBranchDraftCancelPayloadSchema);
export const SettingsGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.get, host.SettingsGetPayloadSchema);
export const SettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.update, host.SettingsUpdatePayloadSchema);
export const SettingsCompleteSetupRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.completeSetup, host.SettingsCompleteSetupPayloadSchema);
export const ProviderListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerList, host.ProviderListPayloadSchema);
export const ProviderUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerUpdate, host.ProviderUpdatePayloadSchema);
export const ProviderDeleteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerDelete, host.ProviderDeletePayloadSchema);
export const ProviderApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerSetApiKey, host.ProviderApiKeyPayloadSchema);
export const ProviderDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.providerDeleteApiKey, host.ProviderDeleteApiKeyPayloadSchema);
export const VoiceTtsApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.voiceTtsSetApiKey, host.VoiceTtsApiKeyPayloadSchema);
export const VoiceTtsDeleteApiKeyRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.voiceTtsDeleteApiKey, host.SettingsGetPayloadSchema);
export const DiscoveryCredentialGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.discoveryCredentialGet, host.DiscoverySourceCredentialStatusPayloadSchema);
export const DiscoveryCredentialSetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.discoveryCredentialSet, host.DiscoverySourceCredentialSetPayloadSchema);
export const DiscoveryCredentialDeleteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.discoveryCredentialDelete, host.DiscoverySourceCredentialStatusPayloadSchema);
export const ApprovalResolveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.approval.resolve, host.ApprovalResolvePayloadSchema);
export const DiscoveryInterestChangeRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.interestChange, host.DiscoveryInterestChangePayloadSchema);
export const DiscoveryConfigurationGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.configurationGet, host.DiscoveryConfigurationGetPayloadSchema);
export const DiscoveryConfigurationUpdateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.configurationUpdate, host.DiscoveryConfigurationUpdatePayloadSchema);
export const DiscoverySourceConnectRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.sourceConnect, host.DiscoverySourceConnectPayloadSchema);
export const DiscoverySourceRefreshRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.sourceRefresh, host.DiscoverySourceRefreshPayloadSchema);
export const DiscoverySessionParticipationRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.sessionParticipationSet, host.DiscoverySessionParticipationPayloadSchema);
export const DiscoveryDailyEnsureRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.dailyEnsure, host.DiscoveryDailyEnsurePayloadSchema);
export const DiscoveryHomeRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.homeGet, host.DiscoveryHomePayloadSchema);
export const DiscoveryRecommendationSearchRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.recommendationsSearch, host.DiscoveryRecommendationSearchPayloadSchema);
export const DiscoveryRecommendationStateRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.discovery.recommendationStateUpdate, host.DiscoveryRecommendationStatePayloadSchema);
export const VoiceSnapshotRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.snapshot, host.VoiceEmptyPayloadSchema);
export const VoiceModelStatusRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.modelStatus, host.VoiceEmptyPayloadSchema);
export const VoiceModelCapabilityRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.modelCapability, host.VoiceModelCapabilityPayloadSchema);
export const VoiceModelsCheckUpdatesRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.modelsCheckUpdates, host.VoiceEmptyPayloadSchema);
export const VoiceModelsPrepareRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.modelsPrepare, z.object({ repair: z.boolean().optional() }).strict());
export const VoiceModelsCancelRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.modelsCancel, host.VoiceEmptyPayloadSchema);
export const VoiceSessionStartRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.sessionStart, host.VoiceSessionStartPayloadSchema);
export const VoiceSessionManualStartRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.sessionManualStart, host.VoiceEmptyPayloadSchema);
export const VoiceSessionManualFinishRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.sessionManualFinish, host.VoiceEmptyPayloadSchema);
export const VoiceSessionMuteRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.sessionMute, host.VoiceSessionMutedPayloadSchema);
export const VoiceSessionEndRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.sessionEnd, host.VoiceEmptyPayloadSchema);
export const VoiceSpeechOutputStopRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.voice.speechOutputStop, host.VoiceEmptyPayloadSchema);
export const ProjectListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectList, host.WorkspaceListProjectsPayloadSchema);
export const ProjectUseExistingRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectUseExisting, host.WorkspaceUseExistingProjectPayloadSchema);
export const ProjectOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectOpen, host.ProjectOpenPayloadSchema);
export const ProjectRemoveRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.projectRemove, host.ProjectRemovePayloadSchema);
export const WorkspaceFilesListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesList, host.WorkspaceFilesListPayloadSchema);
export const WorkspaceFileOpenRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.workspace.filesOpen, host.WorkspaceFileOpenPayloadSchema);
export const ObservabilityListRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.observability.list, host.ObservabilityListPayloadSchema);

/** Dedicated PCM frame payload on the Renderer MessagePort; travels on a bounded
 *  channel, not the business envelope. The Float32Array arrives via structured
 *  clone with its ArrayBuffer transferred. */
export const VoiceInputFramePayloadSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    sampleRate: z.literal(16_000),
    samples: z.instanceof(Float32Array).refine((samples) => samples.length === 512, {
      message: 'PCM frame must be one 512-sample 16 kHz mono frame.',
    }),
  })
  .strict();
export type VoiceInputFramePayload = z.infer<typeof VoiceInputFramePayloadSchema>;
export const ObservabilityGetRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.observability.get, host.ObservabilityRunPayloadSchema);
export const ObservabilityBundleRequestSchema = createRuntimeIpcRequestSchema(IPC_CHANNELS.observability.bundle, host.ObservabilityRunPayloadSchema);

export type InputSuggestionsPayload = z.infer<typeof host.InputSuggestionsPayloadSchema>;
export type SkillListPayload = z.infer<typeof host.SkillListPayloadSchema>;
export type SkillGetPayload = z.infer<typeof host.SkillGetPayloadSchema>;
export type SkillEnablePayload = z.infer<typeof host.SkillEnablePayloadSchema>;
export type SkillDisablePayload = z.infer<typeof host.SkillDisablePayloadSchema>;
export type SkillDeletePayload = z.infer<typeof host.SkillDeletePayloadSchema>;
export type SkillRefreshPayload = z.infer<typeof host.SkillRefreshPayloadSchema>;
export type SessionCreatePayload = z.infer<typeof host.SessionCreatePayloadSchema>;
export type SessionMessageListPayload = z.infer<typeof host.SessionMessageListPayloadSchema>;
export type SessionReadPayload = z.infer<typeof host.SessionReadPayloadSchema>;
export type CommittedRunReadPayload = z.infer<typeof host.CommittedRunReadPayloadSchema>;
export type SessionContextUsageGetPayload = z.infer<typeof host.SessionContextUsageGetPayloadSchema>;
export type ImageInputCapabilitiesPayload = z.infer<typeof host.InputCapabilitiesPayloadSchema>;
export type ImageInputSelectPayload = z.infer<typeof host.ImageInputSelectPayloadSchema>;
export type DocumentInputSelectPayload = z.infer<typeof host.DocumentInputSelectPayloadSchema>;
export type ImageInputClipboardReadPayload = z.infer<typeof host.ImageInputClipboardReadPayloadSchema>;
export type AttachmentImageReadPayload = z.infer<typeof host.AttachmentImageReadPayloadSchema>;
export type AttachmentFileStatusPayload = z.infer<typeof host.AttachmentFileStatusPayloadSchema>;
export type SessionMessageSendPayload = z.infer<typeof host.SessionMessageSendPayloadSchema>;
export type SessionMessageCancelPayload = z.infer<typeof host.SessionMessageCancelPayloadSchema>;
export type SessionBranchDraftCreatePayload = z.infer<typeof host.SessionBranchDraftCreatePayloadSchema>;
export type SessionBranchDraftCancelPayload = z.infer<typeof host.SessionBranchDraftCancelPayloadSchema>;
export type SettingsUpdatePayload = z.infer<typeof host.SettingsUpdatePayloadSchema>;
export type SettingsCompleteSetupPayload = z.infer<typeof host.SettingsCompleteSetupPayloadSchema>;
export type ProviderUpdatePayload = z.infer<typeof host.ProviderUpdatePayloadSchema>;
export type ProviderDeletePayload = z.infer<typeof host.ProviderDeletePayloadSchema>;
export type ProviderApiKeyPayload = z.infer<typeof host.ProviderApiKeyPayloadSchema>;
export type ProviderDeleteApiKeyPayload = z.infer<typeof host.ProviderDeleteApiKeyPayloadSchema>;
export type DiscoveryCredentialStatusPayload = z.infer<typeof host.DiscoverySourceCredentialStatusPayloadSchema>;
export type DiscoveryCredentialSetPayload = z.infer<typeof host.DiscoverySourceCredentialSetPayloadSchema>;
export type ApprovalResolvePayload = z.infer<typeof host.ApprovalResolvePayloadSchema>;
export type DiscoveryInterestChangePayload = z.infer<typeof host.DiscoveryInterestChangePayloadSchema>;
export type DiscoveryConfigurationGetPayload = z.infer<typeof host.DiscoveryConfigurationGetPayloadSchema>;
export type DiscoveryConfigurationUpdatePayload = z.infer<typeof host.DiscoveryConfigurationUpdatePayloadSchema>;
export type DiscoverySourceConnectPayload = z.infer<typeof host.DiscoverySourceConnectPayloadSchema>;
export type DiscoverySourceRefreshPayload = z.infer<typeof host.DiscoverySourceRefreshPayloadSchema>;
export type DiscoverySessionParticipationPayload = z.infer<typeof host.DiscoverySessionParticipationPayloadSchema>;
export type DiscoveryDailyEnsurePayload = z.infer<typeof host.DiscoveryDailyEnsurePayloadSchema>;
export type DiscoveryHomePayload = z.infer<typeof host.DiscoveryHomePayloadSchema>;
export type DiscoveryRecommendationSearchPayload = z.infer<typeof host.DiscoveryRecommendationSearchPayloadSchema>;
export type DiscoveryRecommendationStatePayload = z.infer<typeof host.DiscoveryRecommendationStatePayloadSchema>;
export type VoiceSessionStartPayload = z.infer<typeof host.VoiceSessionStartPayloadSchema>;
export type VoiceModelCapabilityPayload = z.infer<typeof host.VoiceModelCapabilityPayloadSchema>;
export type VoiceSessionMutedPayload = z.infer<typeof host.VoiceSessionMutedPayloadSchema>;
export type ProjectOpenPayload = z.infer<typeof host.ProjectOpenPayloadSchema>;
export type ProjectRemovePayload = z.infer<typeof host.ProjectRemovePayloadSchema>;
export type WorkspaceFilesListPayload = z.infer<typeof host.WorkspaceFilesListPayloadSchema>;
export type WorkspaceFileOpenPayload = z.infer<typeof host.WorkspaceFileOpenPayloadSchema>;
export type ObservabilityListPayload = z.infer<typeof host.ObservabilityListPayloadSchema>;
export type ObservabilityRunPayload = z.infer<typeof host.ObservabilityRunPayloadSchema>;
