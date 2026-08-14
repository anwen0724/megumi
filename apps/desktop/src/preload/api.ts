import { ipcRenderer } from 'electron';
import type { AnyEvent } from '@megumi/product/host';
import type {
  ApprovalHostResult,
  CancelBranchDraftResult,
  CancelUserInputResult,
  CreateBranchDraftResult,
  CreateSessionResult,
  ReadSessionResult,
  ReadCommittedRunResult,
  GetInputSuggestionsResult,
  ListUserMessagesByRunIdsResult,
  GetContextUsageResult,
  ListSessionsResult,
  SendUserInputPayload,
  InputCapabilitiesResult,
  SelectImagesResult,
  SelectDocumentsResult,
  ReadAttachmentImageResult,
  GetAttachmentFileStatusResult,
  EmptyUiResult,
  ProviderListUiResult,
  SettingsData,
  SettingsCompleteSetupPayload,
  SettingsCompleteSetupUiResult,
  SettingsGetPayload,
  SettingsUpdatePayload,
  SettingsUpdateUiResult,
  DisableSkillUiResponse,
  DeleteSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  RefreshSkillsUiResponse,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenFileUiResult,
  WorkspaceOpenProjectUiResult,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiResult,
  WorkspaceListFilesUiResult,
  ObservabilityExportResult,
  ObservabilityGetRunTraceUiResult,
  ObservabilityListRunTracesUiResult,
  VoiceHostModelCapabilityStatus,
  VoiceHostModelStatus,
  VoiceHostModelUpdateResult,
  VoiceHostMutationResult,
  VoiceHostSnapshot,
} from '@megumi/product/host';
import { IPC_CHANNELS } from '../main/ipc/channels';
import type { BusinessIpcChannel, RuntimeIpcRequest, RuntimeIpcResult } from '../main/ipc/contracts';
import type {
  ApprovalResolvePayload,
  InputSuggestionsPayload,
  ProjectOpenPayload,
  ProjectRemovePayload,
  ProviderApiKeyPayload,
  ProviderDeletePayload,
  ProviderDeleteApiKeyPayload,
  ProviderUpdatePayload,
  CommittedRunReadPayload,
  SkillDisablePayload,
  SkillDeletePayload,
  SkillEnablePayload,
  SkillGetPayload,
  SkillListPayload,
  SkillRefreshPayload,
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
  SessionCreatePayload,
  SessionReadPayload,
  SessionMessageCancelPayload,
  SessionContextUsageGetPayload,
  SessionMessageListPayload,
  SessionMessageSendPayload,
  WorkspaceFileOpenPayload,
  WorkspaceFilesListPayload,
  ObservabilityListPayload,
  ObservabilityRunPayload,
  ImageInputCapabilitiesPayload,
  ImageInputSelectPayload,
  DocumentInputSelectPayload,
  ImageInputClipboardReadPayload,
  AttachmentImageReadPayload,
  AttachmentFileStatusPayload,
  VoiceSessionMutedPayload,
  VoiceSessionStartPayload,
  VoiceModelCapabilityPayload,
} from '../main/ipc/schemas';
import {
  SessionMessagePresentationEventSchema,
  type SessionMessagePresentationEvent,
} from '../main/ipc/session-message-presentation';
import type { CharacterWindowShapeRect, CharacterWindowSnapshot } from '../main/app/character-window-controller';
import { parseSpeechInputEvent } from '@megumi/voice/speech-input/speech-input-schema';
import type { SpeechInputEvent } from '@megumi/voice';

type BusinessRequest<TPayload, TChannel extends BusinessIpcChannel> = RuntimeIpcRequest<TPayload, TChannel>;
type EmptyPayload = Record<string, never>;
type EmptyData = Record<string, never>;
type SessionMessageSendData = SendUserInputPayload;
type SessionBranchDraftCreateData = CreateBranchDraftResult['payload'];
type SessionBranchDraftCancelData = CancelBranchDraftResult['payload'];

// MessagePort cannot be passed as an argument of a contextBridge-exposed
// function. The main world transfers it to this isolated world through the
// shared DOM window first; Preload then forwards the real port to Electron Main.
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window) return;
  const message = event.data as { readonly type?: unknown } | null;
  if (!message || message.type !== IPC_CHANNELS.voice.inputPort) return;
  const [port] = event.ports;
  if (!port) return;
  ipcRenderer.postMessage(IPC_CHANNELS.voice.inputPort, null, [port]);
});

async function invokeRuntimeIpc<TPayload, TData extends object, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  request: BusinessRequest<TPayload, TChannel>,
): Promise<RuntimeIpcResult<TData, TChannel>> {
  try {
    return await ipcRenderer.invoke(channel, request) as RuntimeIpcResult<TData, TChannel>;
  } catch {
    return {
      ok: false,
      data: {
        code: 'ipc_invoke_failed',
        message: 'Megumi could not reach the main process.',
      },
      meta: {
        requestId: request.requestId,
        channel,
        handledAt: new Date().toISOString(),
      },
    };
  }
}

export const api = {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.window.minimize),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.window.close),
  },
  provider: {
    list: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.settings.providerList>,
    ): Promise<RuntimeIpcResult<ProviderListUiResult, typeof IPC_CHANNELS.settings.providerList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.providerList, request),
    update: (
      request: BusinessRequest<ProviderUpdatePayload, typeof IPC_CHANNELS.settings.providerUpdate>,
    ): Promise<RuntimeIpcResult<EmptyUiResult, typeof IPC_CHANNELS.settings.providerUpdate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.providerUpdate, request),
    delete: (
      request: BusinessRequest<ProviderDeletePayload, typeof IPC_CHANNELS.settings.providerDelete>,
    ): Promise<RuntimeIpcResult<EmptyUiResult, typeof IPC_CHANNELS.settings.providerDelete>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.providerDelete, request),
    setApiKey: (
      request: BusinessRequest<ProviderApiKeyPayload, typeof IPC_CHANNELS.settings.providerSetApiKey>,
    ): Promise<RuntimeIpcResult<EmptyUiResult, typeof IPC_CHANNELS.settings.providerSetApiKey>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.providerSetApiKey, request),
    deleteApiKey: (
      request: BusinessRequest<ProviderDeleteApiKeyPayload, typeof IPC_CHANNELS.settings.providerDeleteApiKey>,
    ): Promise<RuntimeIpcResult<EmptyUiResult, typeof IPC_CHANNELS.settings.providerDeleteApiKey>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.providerDeleteApiKey, request),
  },
  settings: {
    get: (
      request: BusinessRequest<SettingsGetPayload, typeof IPC_CHANNELS.settings.get>,
    ): Promise<RuntimeIpcResult<SettingsData, typeof IPC_CHANNELS.settings.get>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.get, request),
    update: (
      request: BusinessRequest<SettingsUpdatePayload, typeof IPC_CHANNELS.settings.update>,
    ): Promise<RuntimeIpcResult<SettingsUpdateUiResult, typeof IPC_CHANNELS.settings.update>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.update, request),
    completeSetup: (
      request: BusinessRequest<SettingsCompleteSetupPayload, typeof IPC_CHANNELS.settings.completeSetup>,
    ): Promise<RuntimeIpcResult<SettingsCompleteSetupUiResult, typeof IPC_CHANNELS.settings.completeSetup>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.completeSetup, request),
  },
  command: {
    suggestions: (
      request: BusinessRequest<InputSuggestionsPayload, typeof IPC_CHANNELS.session.inputSuggestions>,
    ): Promise<RuntimeIpcResult<GetInputSuggestionsResult, typeof IPC_CHANNELS.session.inputSuggestions>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.inputSuggestions, request),
  },
  skill: {
    list: (
      request: BusinessRequest<SkillListPayload, typeof IPC_CHANNELS.skill.list>,
    ): Promise<RuntimeIpcResult<ListSkillsUiResponse, typeof IPC_CHANNELS.skill.list>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.list, request),
    get: (
      request: BusinessRequest<SkillGetPayload, typeof IPC_CHANNELS.skill.get>,
    ): Promise<RuntimeIpcResult<GetSkillDetailUiResponse, typeof IPC_CHANNELS.skill.get>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.get, request),
    enable: (
      request: BusinessRequest<SkillEnablePayload, typeof IPC_CHANNELS.skill.enable>,
    ): Promise<RuntimeIpcResult<EnableSkillUiResponse, typeof IPC_CHANNELS.skill.enable>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.enable, request),
    disable: (
      request: BusinessRequest<SkillDisablePayload, typeof IPC_CHANNELS.skill.disable>,
    ): Promise<RuntimeIpcResult<DisableSkillUiResponse, typeof IPC_CHANNELS.skill.disable>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.disable, request),
    delete: (
      request: BusinessRequest<SkillDeletePayload, typeof IPC_CHANNELS.skill.delete>,
    ): Promise<RuntimeIpcResult<DeleteSkillUiResponse, typeof IPC_CHANNELS.skill.delete>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.delete, request),
    refresh: (
      request: BusinessRequest<SkillRefreshPayload, typeof IPC_CHANNELS.skill.refresh>,
    ): Promise<RuntimeIpcResult<RefreshSkillsUiResponse, typeof IPC_CHANNELS.skill.refresh>> =>
      invokeRuntimeIpc(IPC_CHANNELS.skill.refresh, request),
  },
  session: {
    create: (
      request: BusinessRequest<SessionCreatePayload, typeof IPC_CHANNELS.session.sessionCreate>,
    ): Promise<RuntimeIpcResult<CreateSessionResult, typeof IPC_CHANNELS.session.sessionCreate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.sessionCreate, request),
    list: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.session.sessionList>,
    ): Promise<RuntimeIpcResult<ListSessionsResult, typeof IPC_CHANNELS.session.sessionList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.sessionList, request),
    branchDraft: {
      create: (
        request: BusinessRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.session.branchDraftCreate>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCreateData, typeof IPC_CHANNELS.session.branchDraftCreate>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.branchDraftCreate, request),
      cancel: (
        request: BusinessRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.session.branchDraftCancel>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCancelData, typeof IPC_CHANNELS.session.branchDraftCancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.branchDraftCancel, request),
    },
    message: {
      list: (
        request: BusinessRequest<SessionMessageListPayload, typeof IPC_CHANNELS.session.sessionMessageList>,
      ): Promise<RuntimeIpcResult<ListUserMessagesByRunIdsResult, typeof IPC_CHANNELS.session.sessionMessageList>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.sessionMessageList, request),
      send: (
        request: BusinessRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.session.sessionMessageSend>,
      ): Promise<RuntimeIpcResult<SessionMessageSendData, typeof IPC_CHANNELS.session.sessionMessageSend>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.sessionMessageSend, request),
      onPresentationEvent: (callback: (event: SessionMessagePresentationEvent) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
          const parsed = SessionMessagePresentationEventSchema.safeParse(rawEvent);
          if (parsed.success) callback(parsed.data);
        };
        ipcRenderer.on(IPC_CHANNELS.session.sessionMessagePresentation, listener);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.session.sessionMessagePresentation, listener);
      },
      cancel: (
        request: BusinessRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.sessionMessageCancel>,
      ): Promise<RuntimeIpcResult<CancelUserInputResult['payload'], typeof IPC_CHANNELS.session.sessionMessageCancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.sessionMessageCancel, request),
    },
    read: (
      request: BusinessRequest<SessionReadPayload, typeof IPC_CHANNELS.session.sessionRead>,
    ): Promise<RuntimeIpcResult<ReadSessionResult, typeof IPC_CHANNELS.session.sessionRead>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.sessionRead, request),
    readCommittedRun: (
      request: BusinessRequest<CommittedRunReadPayload, typeof IPC_CHANNELS.session.committedRunRead>,
    ): Promise<RuntimeIpcResult<ReadCommittedRunResult, typeof IPC_CHANNELS.session.committedRunRead>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.committedRunRead, request),
    contextUsage: {
      get: (
        request: BusinessRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.session.sessionContextUsageGet>,
      ): Promise<RuntimeIpcResult<GetContextUsageResult, typeof IPC_CHANNELS.session.sessionContextUsageGet>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.sessionContextUsageGet, request),
    },
    imageInput: {
      capabilities: (
        request: BusinessRequest<ImageInputCapabilitiesPayload, typeof IPC_CHANNELS.session.inputCapabilitiesGet>,
      ): Promise<RuntimeIpcResult<InputCapabilitiesResult, typeof IPC_CHANNELS.session.inputCapabilitiesGet>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.inputCapabilitiesGet, request),
      select: (
        request: BusinessRequest<ImageInputSelectPayload, typeof IPC_CHANNELS.session.imageInputSelect>,
      ): Promise<RuntimeIpcResult<SelectImagesResult, typeof IPC_CHANNELS.session.imageInputSelect>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.imageInputSelect, request),
      readClipboard: (
        request: BusinessRequest<ImageInputClipboardReadPayload, typeof IPC_CHANNELS.session.imageInputClipboardRead>,
      ): Promise<RuntimeIpcResult<SelectImagesResult, typeof IPC_CHANNELS.session.imageInputClipboardRead>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.imageInputClipboardRead, request),
      readAttachment: (
        request: BusinessRequest<AttachmentImageReadPayload, typeof IPC_CHANNELS.session.attachmentImageRead>,
      ): Promise<RuntimeIpcResult<ReadAttachmentImageResult, typeof IPC_CHANNELS.session.attachmentImageRead>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.attachmentImageRead, request),
    },
    documentInput: {
      select: (
        request: BusinessRequest<DocumentInputSelectPayload, typeof IPC_CHANNELS.session.documentInputSelect>,
      ): Promise<RuntimeIpcResult<SelectDocumentsResult, typeof IPC_CHANNELS.session.documentInputSelect>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.documentInputSelect, request),
      getAttachmentStatus: (
        request: BusinessRequest<AttachmentFileStatusPayload, typeof IPC_CHANNELS.session.attachmentFileStatus>,
      ): Promise<RuntimeIpcResult<GetAttachmentFileStatusResult, typeof IPC_CHANNELS.session.attachmentFileStatus>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.attachmentFileStatus, request),
    },
  },
  approval: {
    resolve: (
      request: BusinessRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>,
    ): Promise<RuntimeIpcResult<ApprovalHostResult, typeof IPC_CHANNELS.approval.resolve>> =>
      invokeRuntimeIpc(IPC_CHANNELS.approval.resolve, request),
  },
  voiceInput: {
    onEvent: (callback: (event: SpeechInputEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
        // Trust boundary: never deliver an unvalidated event to the app.
        const speechEvent = parseSpeechInputEvent(rawEvent);
        if (speechEvent) callback(speechEvent);
      };
      ipcRenderer.on(IPC_CHANNELS.voice.inputEvent, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.voice.inputEvent, listener);
    },
  },
  voice: {
    getSnapshot: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.snapshot>,
    ): Promise<RuntimeIpcResult<VoiceHostSnapshot, typeof IPC_CHANNELS.voice.snapshot>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.snapshot, request),
    getModelStatus: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.modelStatus>,
    ): Promise<RuntimeIpcResult<VoiceHostModelStatus, typeof IPC_CHANNELS.voice.modelStatus>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.modelStatus, request),
    getModelCapabilityStatus: (
      request: BusinessRequest<VoiceModelCapabilityPayload, typeof IPC_CHANNELS.voice.modelCapability>,
    ): Promise<RuntimeIpcResult<VoiceHostModelCapabilityStatus, typeof IPC_CHANNELS.voice.modelCapability>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.modelCapability, request),
    checkModelUpdates: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.modelsCheckUpdates>,
    ): Promise<RuntimeIpcResult<VoiceHostModelUpdateResult, typeof IPC_CHANNELS.voice.modelsCheckUpdates>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.modelsCheckUpdates, request),
    prepareModels: (
      request: BusinessRequest<{ repair?: boolean }, typeof IPC_CHANNELS.voice.modelsPrepare>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.modelsPrepare>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.modelsPrepare, request),
    cancelModelPreparation: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.modelsCancel>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.modelsCancel>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.modelsCancel, request),
    startSession: (
      request: BusinessRequest<VoiceSessionStartPayload, typeof IPC_CHANNELS.voice.sessionStart>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.sessionStart>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.sessionStart, request),
    startManualUtterance: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.sessionManualStart>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.sessionManualStart>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.sessionManualStart, request),
    finishManualUtterance: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.sessionManualFinish>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.sessionManualFinish>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.sessionManualFinish, request),
    setMuted: (
      request: BusinessRequest<VoiceSessionMutedPayload, typeof IPC_CHANNELS.voice.sessionMute>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.sessionMute>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.sessionMute, request),
    endSession: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.voice.sessionEnd>,
    ): Promise<RuntimeIpcResult<VoiceHostMutationResult, typeof IPC_CHANNELS.voice.sessionEnd>> =>
      invokeRuntimeIpc(IPC_CHANNELS.voice.sessionEnd, request),
  },
  character: {
    show: (): Promise<CharacterWindowSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.character.show),
    hide: (): Promise<CharacterWindowSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.character.hide),
    getSnapshot: (): Promise<CharacterWindowSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.character.snapshot),
    toggleAlwaysOnTop: (): Promise<CharacterWindowSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.character.toggleAlwaysOnTop),
    setScale: (scale: number): Promise<CharacterWindowSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.character.setScale, { scale }),
    setShape: (rects: CharacterWindowShapeRect[]): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.character.setShape, { rects }),
    moveTo: (x: number, y: number): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.character.moveTo, { x, y }),
    openSettings: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.character.openSettings),
    showMainWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.character.showMainWindow),
    selectSession: (sessionId: string | null): Promise<CharacterWindowSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.character.selectSession, { sessionId }),
    onSnapshot: (callback: (snapshot: CharacterWindowSnapshot) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: CharacterWindowSnapshot) => callback(snapshot);
      ipcRenderer.on(IPC_CHANNELS.character.snapshotChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.character.snapshotChanged, listener);
    },
    onOpenSettingsRequested: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on(IPC_CHANNELS.character.settingsRequested, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.character.settingsRequested, listener);
    },
  },
  project: {
    list: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.workspace.projectList>,
    ): Promise<RuntimeIpcResult<WorkspaceListProjectsUiResult, typeof IPC_CHANNELS.workspace.projectList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.workspace.projectList, request),
    useExisting: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.workspace.projectUseExisting>,
    ): Promise<RuntimeIpcResult<WorkspaceUseExistingProjectUiResult, typeof IPC_CHANNELS.workspace.projectUseExisting>> =>
      invokeRuntimeIpc(IPC_CHANNELS.workspace.projectUseExisting, request),
    open: (
      request: BusinessRequest<ProjectOpenPayload, typeof IPC_CHANNELS.workspace.projectOpen>,
    ): Promise<RuntimeIpcResult<WorkspaceOpenProjectUiResult, typeof IPC_CHANNELS.workspace.projectOpen>> =>
      invokeRuntimeIpc(IPC_CHANNELS.workspace.projectOpen, request),
    remove: (
      request: BusinessRequest<ProjectRemovePayload, typeof IPC_CHANNELS.workspace.projectRemove>,
    ): Promise<RuntimeIpcResult<WorkspaceRemoveProjectUiResult, typeof IPC_CHANNELS.workspace.projectRemove>> =>
      invokeRuntimeIpc(IPC_CHANNELS.workspace.projectRemove, request),
  },
  workspace: {
    files: {
      list: (
        request: BusinessRequest<WorkspaceFilesListPayload, typeof IPC_CHANNELS.workspace.filesList>,
      ): Promise<RuntimeIpcResult<WorkspaceListFilesUiResult, typeof IPC_CHANNELS.workspace.filesList>> =>
        invokeRuntimeIpc(IPC_CHANNELS.workspace.filesList, request),
      open: (
        request: BusinessRequest<WorkspaceFileOpenPayload, typeof IPC_CHANNELS.workspace.filesOpen>,
      ): Promise<RuntimeIpcResult<WorkspaceOpenFileUiResult, typeof IPC_CHANNELS.workspace.filesOpen>> =>
        invokeRuntimeIpc(IPC_CHANNELS.workspace.filesOpen, request),
    },
  },
  observability: {
    list: (request: BusinessRequest<ObservabilityListPayload, typeof IPC_CHANNELS.observability.list>): Promise<RuntimeIpcResult<ObservabilityListRunTracesUiResult, typeof IPC_CHANNELS.observability.list>> => invokeRuntimeIpc(IPC_CHANNELS.observability.list, request),
    get: (request: BusinessRequest<ObservabilityRunPayload, typeof IPC_CHANNELS.observability.get>): Promise<RuntimeIpcResult<ObservabilityGetRunTraceUiResult, typeof IPC_CHANNELS.observability.get>> => invokeRuntimeIpc(IPC_CHANNELS.observability.get, request),
    createBundle: (request: BusinessRequest<ObservabilityRunPayload, typeof IPC_CHANNELS.observability.bundle>): Promise<RuntimeIpcResult<ObservabilityExportResult, typeof IPC_CHANNELS.observability.bundle>> => invokeRuntimeIpc(IPC_CHANNELS.observability.bundle, request),
  },
  runtime: {
    onEvent: (callback: (event: AnyEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, runtimeEvent: AnyEvent) => {
        callback(runtimeEvent);
      };

      ipcRenderer.on(IPC_CHANNELS.runtime.event, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.runtime.event, listener);
    },
  },
};
