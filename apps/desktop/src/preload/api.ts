import { ipcRenderer } from 'electron';
import { generateRuntimeDebugId, type RuntimeEvent } from '@megumi/product/runtime-events';
import type {
  ApprovalHostResult,
  ChatCancelBranchDraftUiResult,
  ChatCancelUserInputUiResult,
  ChatCreateBranchDraftUiResult,
  ChatCreateSessionUiResult,
  ChatGetSessionHydrationUiResult,
  ChatGetCommandSuggestionsUiResult,
  ChatListMessagesUiResult,
  ChatGetContextUsageUiResult,
  ChatListRunEventsUiResult,
  ChatListRunsUiResult,
  ChatListSessionsUiResult,
  ChatListTimelineUiResult,
  ChatSendUserInputUiPayload,
  EmptyUiResult,
  ProviderListUiResult,
  SettingsData,
  SettingsCompleteSetupPayload,
  SettingsCompleteSetupUiResult,
  SettingsGetPayload,
  SettingsUpdatePayload,
  SettingsUpdateUiResult,
  DisableSkillUiResponse,
  EnableSkillUiResponse,
  GetSkillDetailUiResponse,
  ListSkillsUiResponse,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenFileUiResult,
  WorkspaceOpenProjectUiResult,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiResult,
  ArtifactGetData,
  ArtifactListData,
  ArtifactReferenceData,
  ArtifactStatusUpdateData,
  ArtifactVersionCreateData,
  ArtifactVersionGetData,
  WorkspaceListFilesUiResult,
} from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../main/ipc/channels';
import type { BusinessIpcChannel, RuntimeIpcRequest, RuntimeIpcResult } from '../main/ipc/contracts';
import type { RuntimeIpcError } from '../main/ipc/errors';
import type { CreateDiagnosticBundleResult, GetRunTraceResult, ListRecentRunTracesResult } from '@megumi/observability';
import type {
  ApprovalResolvePayload,
  ArtifactGetPayload,
  ArtifactListByRunPayload,
  ArtifactListBySessionPayload,
  ArtifactReferencePayload,
  ArtifactStatusUpdatePayload,
  ArtifactVersionCreatePayload,
  ArtifactVersionGetPayload,
  CommandSuggestionsPayload,
  ProjectOpenPayload,
  ProjectRemovePayload,
  ProviderApiKeyPayload,
  ProviderDeletePayload,
  ProviderDeleteApiKeyPayload,
  ProviderUpdatePayload,
  RunEventsListPayload,
  RunListBySessionPayload,
  SkillDisablePayload,
  SkillEnablePayload,
  SkillGetPayload,
  SkillListPayload,
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreatePayload,
  SessionCreatePayload,
  SessionHydrationGetPayload,
  SessionMessageCancelPayload,
  SessionContextUsageGetPayload,
  SessionMessageListPayload,
  SessionMessageSendPayload,
  SessionTimelineListPayload,
  WorkspaceFileOpenPayload,
  WorkspaceFilesListPayload,
  ObservabilityListPayload,
  ObservabilityRunPayload,
} from '../main/ipc/schemas';

type BusinessRequest<TPayload, TChannel extends BusinessIpcChannel> = RuntimeIpcRequest<TPayload, TChannel>;
type EmptyPayload = Record<string, never>;
type EmptyData = Record<string, never>;
type SessionMessageSendData = ChatSendUserInputUiPayload;
type SessionBranchDraftCreateData = ChatCreateBranchDraftUiResult['payload'];
type SessionBranchDraftCancelData = ChatCancelBranchDraftUiResult['payload'];

async function invokeRuntimeIpc<TPayload, TData extends object, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  request: BusinessRequest<TPayload, TChannel>,
): Promise<RuntimeIpcResult<TData, TChannel>> {
  try {
    return await ipcRenderer.invoke(channel, request) as RuntimeIpcResult<TData, TChannel>;
  } catch {
    const debugId = request.context?.debugId ?? generateRuntimeDebugId();

    return {
      ok: false,
      data: createPreloadInvokeError(debugId),
      meta: {
        requestId: request.requestId,
        channel,
        traceId: request.context?.traceId,
        debugId,
        operationName: request.context?.operationName,
        handledAt: new Date().toISOString(),
      },
    };
  }
}

function createPreloadInvokeError(debugId: string): RuntimeIpcError {
  return {
    code: 'ipc_invoke_failed',
    message: 'Megumi could not reach the main process.',
    severity: 'error',
    retryable: true,
    source: 'preload',
    debugId,
  };
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
      request: BusinessRequest<CommandSuggestionsPayload, typeof IPC_CHANNELS.chat.commandSuggestions>,
    ): Promise<RuntimeIpcResult<ChatGetCommandSuggestionsUiResult, typeof IPC_CHANNELS.chat.commandSuggestions>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.commandSuggestions, request),
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
  },
  session: {
    create: (
      request: BusinessRequest<SessionCreatePayload, typeof IPC_CHANNELS.chat.sessionCreate>,
    ): Promise<RuntimeIpcResult<ChatCreateSessionUiResult, typeof IPC_CHANNELS.chat.sessionCreate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.sessionCreate, request),
    list: (
      request: BusinessRequest<EmptyPayload, typeof IPC_CHANNELS.chat.sessionList>,
    ): Promise<RuntimeIpcResult<ChatListSessionsUiResult, typeof IPC_CHANNELS.chat.sessionList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.sessionList, request),
    branchDraft: {
      create: (
        request: BusinessRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.chat.branchDraftCreate>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCreateData, typeof IPC_CHANNELS.chat.branchDraftCreate>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.branchDraftCreate, request),
      cancel: (
        request: BusinessRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.chat.branchDraftCancel>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCancelData, typeof IPC_CHANNELS.chat.branchDraftCancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.branchDraftCancel, request),
    },
    message: {
      list: (
        request: BusinessRequest<SessionMessageListPayload, typeof IPC_CHANNELS.chat.sessionMessageList>,
      ): Promise<RuntimeIpcResult<ChatListMessagesUiResult, typeof IPC_CHANNELS.chat.sessionMessageList>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionMessageList, request),
      send: (
        request: BusinessRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.chat.sessionMessageSend>,
      ): Promise<RuntimeIpcResult<SessionMessageSendData, typeof IPC_CHANNELS.chat.sessionMessageSend>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionMessageSend, request),
      cancel: (
        request: BusinessRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.chat.sessionMessageCancel>,
      ): Promise<RuntimeIpcResult<ChatCancelUserInputUiResult['payload'], typeof IPC_CHANNELS.chat.sessionMessageCancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionMessageCancel, request),
    },
    timeline: {
      list: (
        request: BusinessRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.chat.sessionTimelineList>,
      ): Promise<RuntimeIpcResult<ChatListTimelineUiResult, typeof IPC_CHANNELS.chat.sessionTimelineList>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionTimelineList, request),
    },
    hydration: {
      get: (
        request: BusinessRequest<SessionHydrationGetPayload, typeof IPC_CHANNELS.chat.sessionHydrationGet>,
      ): Promise<RuntimeIpcResult<ChatGetSessionHydrationUiResult, typeof IPC_CHANNELS.chat.sessionHydrationGet>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionHydrationGet, request),
    },
    contextUsage: {
      get: (
        request: BusinessRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.chat.sessionContextUsageGet>,
      ): Promise<RuntimeIpcResult<ChatGetContextUsageUiResult, typeof IPC_CHANNELS.chat.sessionContextUsageGet>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.sessionContextUsageGet, request),
    },
  },
  run: {
    listBySession: (
      request: BusinessRequest<RunListBySessionPayload, typeof IPC_CHANNELS.chat.runListBySession>,
    ): Promise<RuntimeIpcResult<ChatListRunsUiResult, typeof IPC_CHANNELS.chat.runListBySession>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.runListBySession, request),
    events: {
      list: (
        request: BusinessRequest<RunEventsListPayload, typeof IPC_CHANNELS.chat.runEventsList>,
      ): Promise<RuntimeIpcResult<ChatListRunEventsUiResult, typeof IPC_CHANNELS.chat.runEventsList>> =>
        invokeRuntimeIpc(IPC_CHANNELS.chat.runEventsList, request),
    },
  },
  approval: {
    resolve: (
      request: BusinessRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>,
    ): Promise<RuntimeIpcResult<ApprovalHostResult, typeof IPC_CHANNELS.approval.resolve>> =>
      invokeRuntimeIpc(IPC_CHANNELS.approval.resolve, request),
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
  artifacts: {
    listByRun: (
      request: BusinessRequest<ArtifactListByRunPayload, typeof IPC_CHANNELS.artifacts.listByRun>,
    ): Promise<RuntimeIpcResult<ArtifactListData, typeof IPC_CHANNELS.artifacts.listByRun>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.listByRun, request),
    listBySession: (
      request: BusinessRequest<ArtifactListBySessionPayload, typeof IPC_CHANNELS.artifacts.listBySession>,
    ): Promise<RuntimeIpcResult<ArtifactListData, typeof IPC_CHANNELS.artifacts.listBySession>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.listBySession, request),
    get: (
      request: BusinessRequest<ArtifactGetPayload, typeof IPC_CHANNELS.artifacts.get>,
    ): Promise<RuntimeIpcResult<ArtifactGetData, typeof IPC_CHANNELS.artifacts.get>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.get, request),
    getVersion: (
      request: BusinessRequest<ArtifactVersionGetPayload, typeof IPC_CHANNELS.artifacts.versionGet>,
    ): Promise<RuntimeIpcResult<ArtifactVersionGetData, typeof IPC_CHANNELS.artifacts.versionGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.versionGet, request),
    createVersion: (
      request: BusinessRequest<ArtifactVersionCreatePayload, typeof IPC_CHANNELS.artifacts.versionCreate>,
    ): Promise<RuntimeIpcResult<ArtifactVersionCreateData, typeof IPC_CHANNELS.artifacts.versionCreate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.versionCreate, request),
    updateStatus: (
      request: BusinessRequest<ArtifactStatusUpdatePayload, typeof IPC_CHANNELS.artifacts.statusUpdate>,
    ): Promise<RuntimeIpcResult<ArtifactStatusUpdateData, typeof IPC_CHANNELS.artifacts.statusUpdate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.statusUpdate, request),
    reference: (
      request: BusinessRequest<ArtifactReferencePayload, typeof IPC_CHANNELS.artifacts.reference>,
    ): Promise<RuntimeIpcResult<ArtifactReferenceData, typeof IPC_CHANNELS.artifacts.reference>> =>
      invokeRuntimeIpc(IPC_CHANNELS.artifacts.reference, request),
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
    list: (request: BusinessRequest<ObservabilityListPayload, typeof IPC_CHANNELS.observability.list>): Promise<RuntimeIpcResult<ListRecentRunTracesResult, typeof IPC_CHANNELS.observability.list>> => invokeRuntimeIpc(IPC_CHANNELS.observability.list, request),
    get: (request: BusinessRequest<ObservabilityRunPayload, typeof IPC_CHANNELS.observability.get>): Promise<RuntimeIpcResult<GetRunTraceResult, typeof IPC_CHANNELS.observability.get>> => invokeRuntimeIpc(IPC_CHANNELS.observability.get, request),
    createBundle: (request: BusinessRequest<ObservabilityRunPayload, typeof IPC_CHANNELS.observability.bundle>): Promise<RuntimeIpcResult<CreateDiagnosticBundleResult | {status:'saved';directory:string} | {status:'cancelled'} | {status:'failed';message:string}, typeof IPC_CHANNELS.observability.bundle>> => invokeRuntimeIpc(IPC_CHANNELS.observability.bundle, request),
  },
  runtime: {
    onEvent: (callback: (event: RuntimeEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, runtimeEvent: RuntimeEvent) => {
        callback(runtimeEvent);
      };

      ipcRenderer.on(IPC_CHANNELS.runtime.event, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.runtime.event, listener);
    },
  },
};
