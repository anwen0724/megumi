/*
 * Defines the application interface and renderer-safe exports of module contracts.
 */
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { ApprovalHost } from './coding/approvals/contracts';
import type { EventFilter, EventHandler, EventSubscription } from './coding/events/event-bus';
import type { SessionHost } from './coding/session-contracts';
import type { ObservabilityHost } from './observability/observability-contracts';
import type { RecommendationHost } from './recommendation/recommendation-contracts';
import type { MemoryHost } from './memory/contracts';
import type { Settings } from './settings/settings-store';
import type { SkillHost } from './skills/contracts';
import type { SpeechOutputEventListener, SpeechOutputSubscription } from './voice/index';
import type { VoiceHost } from './voice/voice-contracts';
import type { WorkspaceHost } from './workspace/workspace-contracts';

export type { EventFilter, EventHandler, EventSubscription } from './coding/events/event-bus';

export interface ApplicationOperations {
  workspace: WorkspaceHost;
  session: SessionHost;
  skill: SkillHost;
  settings: Settings;
  models: {
    /** Lists added models and the available provider catalog for settings UI. */
    readModelCatalog(request?: { workspaceId?: string }): ModelCatalogResult;
  };
  tools: {
    /** Lists tool identities available to the application. */
    listAvailableTools(request?: { includeDisabled?: boolean }): {
      tools: readonly {
        identity: { sourceId: string; namespace: string; sourceToolName: string };
        registeredToolName: string;
        definition: { name: string };
      }[];
    };
  };
  approval: ApprovalHost;
  observability: ObservabilityHost;
  voice: VoiceHost;
  recommendation: RecommendationHost;
  memory: MemoryHost;
}

export interface ApplicationLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export type BackgroundTriggerMode = 'automatic' | 'manual';

export interface ApplicationStartOptions {
  readonly backgroundTriggers?: BackgroundTriggerMode;
}

export interface Application extends ApplicationOperations {
  readonly logger: ApplicationLogger;
  /** Starts Host-ready product behavior exactly once using the first caller's trigger mode. */
  start(options?: ApplicationStartOptions): Promise<void>;
  /** Checks due background work after OS resume without restarting the application. */
  resume(): Promise<void>;
  /** Stops business execution while retaining resources for final read-only capture. */
  stop(): Promise<void>;
  /** Subscribes to Coding session events without participating in execution or persistence. */
  subscribeRuntimeEvents(filter: EventFilter, handler: EventHandler): EventSubscription;
  /** Subscribes to synthesized speech output owned by the application. */
  subscribeSpeechOutputEvents(handler: SpeechOutputEventListener): SpeechOutputSubscription;
  /** Stops business work before releasing subscriptions, diagnostics and storage. */
  dispose(): Promise<void>;
}

export { EventSchema as RuntimeEventSchema } from './coding/events/contracts';
export type { AnyEvent } from './coding/events/contracts';

export type {
  CancelBranchDraftResult, CancelUserInputPayload, CancelUserInputResult, CreateBranchDraftResult,
  CreateSessionResult, GetAttachmentFileStatusRequest,
  GetAttachmentFileStatusResult, GetContextUsageResult, GetInputSuggestionsResult, InputCapabilitiesResult, InputSuggestionQueryItem,
  InputSuggestionQueryResult, ListSessionsResult, ListUserMessagesByExecutionIdsResult, PermissionMode, ReadAttachmentImageRequest,
  ReadAttachmentImageResult, ReadCommittedRunRequest,
  ReadCommittedRunResult, ReadSessionRequest,
  ReadSessionResult, RunDto, SelectDocumentsResult, SelectedDocumentDto, SelectedImageDto, SelectImagesResult, SendUserInputPayload,
  SendUserInputRequest,
  SendUserInputResult, SessionBranchConversationItemDto, SessionConversationItemDto, SessionDto, SessionHost, SessionMessageConversationItemDto,
  SessionMessageDto, SessionReadDiagnosticDto,
  SessionRuntimeEventRangeDto, UserMessageDto, UserMessageSummaryDto, WorkspaceChangeSummaryDto
} from './coding/session-contracts';
export type { AttachmentPicker } from './platform/attachment-picker';
export type { DirectoryPicker, DirectoryPickerResult } from './platform/directory-picker';
export type { FileOpener, FileOpenResult } from './platform/file-opener';
export type { LocalFileAvailability } from './platform/local-file-availability';
export type { ProductWorkspaceFileSystem } from './platform/workspace-file-system';
export * from './recommendation/recommendation-contracts';
export type {
  DeleteSkillUiResponse, DisableSkillUiResponse, EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  RefreshSkillsUiResponse,
  SkillDetailUiDto,
  SkillHost,
  SkillListUiItem
} from './skills/contracts';
export type {
  WorkspaceFileEntryUiDto, WorkspaceHost, WorkspaceListFilesUiResult,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenFileUiResult,
  WorkspaceOpenProjectUiResult,
  WorkspaceProjectUiDto,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiResult
} from './workspace/workspace-contracts';

export type {
  ApprovalHost,
  ApprovalHostResult,
  ApprovalResolvePayload
} from './coding/approvals/contracts';
export {
  AttachmentFileStatusPayloadSchema, AttachmentFileStatusResultSchema, AttachmentImageReadPayloadSchema, CancelBranchDraftPayloadSchema, CancelUserInputPayloadSchema, CommittedRunReadPayloadSchema, CreateBranchDraftPayloadSchema, CreateSessionResultSchema, DocumentInputSelectPayloadSchema, GetContextUsageResultSchema, GetInputSuggestionsResultSchema, ImageInputClipboardReadPayloadSchema, ImageInputSelectPayloadSchema, InputCapabilitiesPayloadSchema, InputCapabilitiesResultSchema, InputSuggestionsPayloadSchema, ListSessionsResultSchema,
  ListUserMessagesByExecutionIdsResultSchema, ReadAttachmentImageResultSchema, ReadCommittedRunResultSchema, ReadSessionResultSchema, RunDtoSchema, SelectDocumentsResultSchema, SelectImagesResultSchema, SendUserInputPayloadSchema, SessionBranchConversationItemDtoSchema, SessionBranchDraftCancelPayloadSchema, SessionBranchDraftCreatePayloadSchema, SessionContextUsageGetPayloadSchema, SessionConversationItemDtoSchema, SessionCreatePayloadSchema, SessionDtoSchema, SessionListPayloadSchema, SessionMessageCancelPayloadSchema, SessionMessageConversationItemDtoSchema, SessionMessageDtoSchema, SessionMessageListPayloadSchema, SessionMessageSendPayloadSchema, SessionReadPayloadSchema, UserMessageDtoSchema, WorkspaceChangeSummaryDtoSchema
} from './coding/session-contracts';
export {
  ObservabilityContentPayloadSchema,
  ObservabilityCorrelationSchema,
  ObservabilityEmptyPayloadSchema,
  ObservabilityExportResultSchema,
  ObservabilityGetContentResultSchema,
  ObservabilityGetTraceResultSchema,
  ObservabilityHealthResultSchema,
  ObservabilityListPayloadSchema,
  ObservabilityListResultSchema,
  ObservabilityRebuildResultSchema,
  ObservabilityTracePayloadSchema
} from './observability/observability-contracts';
export type {
  DiagnosticBundleDto,
  DiagnosticBundleFileDto,
  ObservabilityContentCheckpointUiDto,
  ObservabilityCorrelationUiDto,
  ObservabilityDiagnosticErrorUiDto,
  ObservabilityEventUiDto,
  ObservabilityExportResult,
  ObservabilityGetContentResult,
  ObservabilityGetTraceResult,
  ObservabilityHealthResult,
  ObservabilityHealthUiDto, ObservabilityHost, ObservabilityListResult,
  ObservabilityRebuildResult,
  ObservabilitySpanUiDto,
  ObservabilityTraceDetailUiDto,
  ObservabilityTraceSummaryUiDto
} from './observability/observability-contracts';
export type { DiagnosticBundleSaver } from './platform/diagnostic-bundle-saver';
export {
  DeleteSkillUiResponseSchema, DisableSkillUiResponseSchema, EnableSkillUiResponseSchema, GetSkillDetailUiResponseSchema, ListSkillsUiResponseSchema, RefreshSkillsUiResponseSchema, SkillDeletePayloadSchema, SkillDisablePayloadSchema, SkillEnablePayloadSchema, SkillGetPayloadSchema, SkillListPayloadSchema, SkillRefreshPayloadSchema
} from './skills/contracts';
export {
  VoiceEmptyPayloadSchema, VoiceHostMutationResultSchema, VoiceModelCapabilityPayloadSchema,
  VoiceModelCapabilityStatusSchema, VoiceModelStatusResultSchema, VoiceModelUpdateResultSchema, VoiceSessionMutedPayloadSchema,
  VoiceSessionStartPayloadSchema,
  VoiceSnapshotSchema
} from './voice/voice-contracts';
export type {
  VoiceHost, VoiceHostModelCapabilityStatus, VoiceHostModelStatus,
  VoiceHostModelUpdateResult,
  VoiceHostMutationResult,
  VoiceHostSnapshot, VoiceModelCapabilityPayload, VoiceSessionMutedPayload,
  VoiceSessionStartPayload
} from './voice/voice-contracts';
export {
  ProjectOpenPayloadSchema,
  ProjectRemovePayloadSchema, WorkspaceFileOpenPayloadSchema, WorkspaceFilesListPayloadSchema, WorkspaceListFilesUiResultSchema, WorkspaceListProjectsPayloadSchema, WorkspaceListProjectsUiResultSchema, WorkspaceOpenFileUiResultSchema, WorkspaceOpenProjectUiResultSchema,
  WorkspaceRemoveProjectUiResultSchema, WorkspaceUseExistingProjectPayloadSchema, WorkspaceUseExistingProjectUiResultSchema
} from './workspace/workspace-contracts';

export { ApprovalResolvePayloadSchema, ApprovalResolveResultSchema } from './coding/approvals/contracts';

export { ObservabilityTraceMeasurementsSchema } from './observability/observability-contracts';

export {
  SessionModelSelectionPayloadSchema,
  SessionModelSelectionResultSchema
} from './coding/session-contracts';
export type {
  SessionModelSelectionPayload,
  SessionModelSelectionResult
} from './coding/session-contracts';

export type { AppLanguage, AppThemeName } from './settings/settings-contracts';


export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelParameters {
  name?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<
    Record<'streaming' | 'toolCalls' | 'thinking' | 'imageInput', boolean | 'unknown'>
  >;
}
export interface ProviderConfiguration {
  name?: string;
  api?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  models: Record<string, ModelParameters>;
}

/** The runtime consumes full snapshots structurally; definitions remain in Settings. */
export interface ModelSettingsAccess {
  readSettings():
    | {
      status: 'ok';
      settings: {
        config: {
          general: { lastSelectedModel?: { providerId: string; modelId: string } };
          providers: Record<string, ProviderConfiguration>;
          context: { compactionThresholdRatio: number };
        };
      };
    }
    | { status: 'rejected'; error: { code: string; message: string } };
  readCredential(request: {
    target: { kind: 'provider'; providerId: string };
    apiKeyEnv?: string;
  }):
    | { status: 'found'; value: string; source: 'stored' | 'environment' }
    | { status: 'missing' }
    | { status: 'rejected'; error: { code: string; message: string } };
}

export interface ConfiguredModel {
  model: Model<Api>;
  enabled: boolean;
  custom: boolean;
  capabilities: Required<NonNullable<ModelParameters['capabilities']>>;
}
export interface ConfiguredProvider {
  id: string;
  name: string;
  enabled: boolean;
  api?: string;
  baseUrl?: string;
  models: ConfiguredModel[];
}
export type ModelCatalogResult =
  | { status: 'ok'; providers: ConfiguredProvider[]; catalog: ConfiguredProvider[] }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

const SupportSchema = z.union([z.boolean(), z.literal('unknown')]);
const ConfiguredProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  api: z.string().optional(),
  baseUrl: z.string().optional(),
  models: z.array(
    z.object({
      enabled: z.boolean(),
      custom: z.boolean(),
      capabilities: z.object({
        streaming: SupportSchema,
        toolCalls: SupportSchema,
        thinking: SupportSchema,
        imageInput: SupportSchema,
      }),
      model: z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        api: z.string(),
        baseUrl: z.string(),
        reasoning: z.boolean(),
        input: z.array(z.enum(['text', 'image'])),
        cost: z.object({
          input: z.number(),
          output: z.number(),
          cacheRead: z.number(),
          cacheWrite: z.number(),
        }),
        contextWindow: z.number(),
        maxTokens: z.number(),
      }),
    }),
  ),
});
export const ModelCatalogResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('failed'),
    failure: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    status: z.literal('ok'),
    providers: z.array(ConfiguredProviderSchema),
    catalog: z.array(ConfiguredProviderSchema),
  }),
]);
