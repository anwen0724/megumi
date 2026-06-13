import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  BusinessIpcChannel,
  RuntimeIpcRequest,
  RuntimeIpcResult,
} from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import { createRuntimeDebugId } from '@megumi/shared/runtime';
import type {
  ProjectListData,
  ProjectListPayload,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
  ProjectUseExistingPayload,
} from '@megumi/shared/project';
import type {
  ArtifactGetData,
  ArtifactGetPayload,
  ArtifactListByRunPayload,
  ArtifactListBySessionPayload,
  ArtifactListData,
  ArtifactReferenceData,
  ArtifactReferencePayload,
  ArtifactStatusUpdateData,
  ArtifactStatusUpdatePayload,
  ArtifactVersionCreateData,
  ArtifactVersionCreatePayload,
  ArtifactVersionGetData,
  ArtifactVersionGetPayload,
  ApprovalResolveData,
  ApprovalResolvePayload,
  MemoryAccessLogsListData,
  MemoryAccessLogsListPayload,
  MemoryCandidateAcceptData,
  MemoryCandidateAcceptPayload,
  MemoryCandidateArchivePayload,
  MemoryCandidateData,
  MemoryCandidateEditAndAcceptPayload,
  MemoryCandidateListData,
  MemoryCandidateListPayload,
  MemoryCandidateRejectPayload,
  MemoryData,
  MemoryGetData,
  MemoryGetPayload,
  MemoryListData,
  MemoryListPayload,
  MemoryRecallPreviewData,
  MemoryRecallPreviewPayload,
  MemorySettingsData,
  MemorySettingsGetPayload,
  MemorySettingsUpdatePayload,
  MemorySourceRefsListData,
  MemorySourceRefsListPayload,
  MemoryStatusPayload,
  MemoryUpdatePayload,
  PlanByRunGetData,
  PlanByRunGetPayload,
  PlanStatusUpdateData,
  PlanStatusUpdatePayload,
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderListPayload,
  ProviderUpdatePayload,
  SettingsData,
  SettingsGetPayload,
  SettingsUpdatePayload,
  RecoverableRunListData,
  RecoverableRunListPayload,
  RunCancelData,
  RunCancelPayload,
  RunContextBaselineGetData,
  RunContextBaselineGetPayload,
  RunContextSourcesListData,
  RunContextSourcesListPayload,
  RunEventsListData,
  RunEventsListPayload,
  RunListBySessionData,
  RunListBySessionPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
  WorkspaceRestoreData,
  WorkspaceRestorePayload,
  SessionCreateData,
  SessionCreatePayload,
  SessionBranchDraftCancelData,
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreateData,
  SessionBranchDraftCreatePayload,
  SessionListData,
  SessionListPayload,
  SessionMessageCancelData,
  SessionMessageCancelPayload,
  SessionMessageListData,
  SessionMessageListPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
  ToolExecutionGetData,
  ToolExecutionGetPayload,
  ToolDefinitionsListData,
  ToolDefinitionsListPayload,
  WorkspaceFileOpenData,
  WorkspaceFileOpenPayload,
  WorkspaceFilesListData,
  WorkspaceFilesListPayload,
} from '@megumi/shared/ipc';

type BusinessRequest<TPayload, TChannel extends BusinessIpcChannel> = RuntimeIpcRequest<TPayload, TChannel>;
type EmptyData = Record<string, never>;

async function invokeRuntimeIpc<TPayload, TData extends object, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  request: BusinessRequest<TPayload, TChannel>,
): Promise<RuntimeIpcResult<TData, TChannel>> {
  try {
    return await ipcRenderer.invoke(channel, request) as RuntimeIpcResult<TData, TChannel>;
  } catch {
    const debugId = request.context?.debugId ?? createRuntimeDebugId();

    return {
      ok: false,
      error: createPreloadInvokeError(debugId),
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
      request: BusinessRequest<ProviderListPayload, typeof IPC_CHANNELS.provider.list>,
    ): Promise<RuntimeIpcResult<ProviderListData, typeof IPC_CHANNELS.provider.list>> =>
      invokeRuntimeIpc(IPC_CHANNELS.provider.list, request),
    update: (
      request: BusinessRequest<ProviderUpdatePayload, typeof IPC_CHANNELS.provider.update>,
    ): Promise<RuntimeIpcResult<EmptyData, typeof IPC_CHANNELS.provider.update>> =>
      invokeRuntimeIpc(IPC_CHANNELS.provider.update, request),
    setApiKey: (
      request: BusinessRequest<ProviderApiKeyPayload, typeof IPC_CHANNELS.provider.setApiKey>,
    ): Promise<RuntimeIpcResult<EmptyData, typeof IPC_CHANNELS.provider.setApiKey>> =>
      invokeRuntimeIpc(IPC_CHANNELS.provider.setApiKey, request),
    deleteApiKey: (
      request: BusinessRequest<ProviderDeleteApiKeyPayload, typeof IPC_CHANNELS.provider.deleteApiKey>,
    ): Promise<RuntimeIpcResult<EmptyData, typeof IPC_CHANNELS.provider.deleteApiKey>> =>
      invokeRuntimeIpc(IPC_CHANNELS.provider.deleteApiKey, request),
  },
  settings: {
    get: (
      request: BusinessRequest<SettingsGetPayload, typeof IPC_CHANNELS.settings.get>,
    ): Promise<RuntimeIpcResult<SettingsData, typeof IPC_CHANNELS.settings.get>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.get, request),
    update: (
      request: BusinessRequest<SettingsUpdatePayload, typeof IPC_CHANNELS.settings.update>,
    ): Promise<RuntimeIpcResult<SettingsData, typeof IPC_CHANNELS.settings.update>> =>
      invokeRuntimeIpc(IPC_CHANNELS.settings.update, request),
  },
  session: {
    create: (
      request: BusinessRequest<SessionCreatePayload, typeof IPC_CHANNELS.session.create>,
    ): Promise<RuntimeIpcResult<SessionCreateData, typeof IPC_CHANNELS.session.create>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.create, request),
    list: (
      request: BusinessRequest<SessionListPayload, typeof IPC_CHANNELS.session.list>,
    ): Promise<RuntimeIpcResult<SessionListData, typeof IPC_CHANNELS.session.list>> =>
      invokeRuntimeIpc(IPC_CHANNELS.session.list, request),
    branchDraft: {
      create: (
        request: BusinessRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.session.branchDraft.create>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCreateData, typeof IPC_CHANNELS.session.branchDraft.create>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.branchDraft.create, request),
      cancel: (
        request: BusinessRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.session.branchDraft.cancel>,
      ): Promise<RuntimeIpcResult<SessionBranchDraftCancelData, typeof IPC_CHANNELS.session.branchDraft.cancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.branchDraft.cancel, request),
    },
    message: {
      list: (
        request: BusinessRequest<SessionMessageListPayload, typeof IPC_CHANNELS.session.message.list>,
      ): Promise<RuntimeIpcResult<SessionMessageListData, typeof IPC_CHANNELS.session.message.list>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.message.list, request),
      send: (
        request: BusinessRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.session.message.send>,
      ): Promise<RuntimeIpcResult<SessionMessageSendData, typeof IPC_CHANNELS.session.message.send>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.message.send, request),
      cancel: (
        request: BusinessRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.message.cancel>,
      ): Promise<RuntimeIpcResult<SessionMessageCancelData, typeof IPC_CHANNELS.session.message.cancel>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.message.cancel, request),
    },
    timeline: {
      list: (
        request: BusinessRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.session.timeline.list>,
      ): Promise<RuntimeIpcResult<SessionTimelineListData, typeof IPC_CHANNELS.session.timeline.list>> =>
        invokeRuntimeIpc(IPC_CHANNELS.session.timeline.list, request),
    },
  },
  run: {
    listBySession: (
      request: BusinessRequest<RunListBySessionPayload, typeof IPC_CHANNELS.run.listBySession>,
    ): Promise<RuntimeIpcResult<RunListBySessionData, typeof IPC_CHANNELS.run.listBySession>> =>
      invokeRuntimeIpc(IPC_CHANNELS.run.listBySession, request),
    events: {
      list: (
        request: BusinessRequest<RunEventsListPayload, typeof IPC_CHANNELS.run.events.list>,
      ): Promise<RuntimeIpcResult<RunEventsListData, typeof IPC_CHANNELS.run.events.list>> =>
        invokeRuntimeIpc(IPC_CHANNELS.run.events.list, request),
    },
  },
  runContext: {
    baselineGet: (
      request: BusinessRequest<RunContextBaselineGetPayload, typeof IPC_CHANNELS.runContext.baselineGet>,
    ): Promise<RuntimeIpcResult<RunContextBaselineGetData, typeof IPC_CHANNELS.runContext.baselineGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.runContext.baselineGet, request),
    sourcesList: (
      request: BusinessRequest<RunContextSourcesListPayload, typeof IPC_CHANNELS.runContext.sourcesList>,
    ): Promise<RuntimeIpcResult<RunContextSourcesListData, typeof IPC_CHANNELS.runContext.sourcesList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.runContext.sourcesList, request),
  },
  plan: {
    byRunGet: (
      request: BusinessRequest<PlanByRunGetPayload, typeof IPC_CHANNELS.plan.byRunGet>,
    ): Promise<RuntimeIpcResult<PlanByRunGetData, typeof IPC_CHANNELS.plan.byRunGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.plan.byRunGet, request),
    statusUpdate: (
      request: BusinessRequest<PlanStatusUpdatePayload, typeof IPC_CHANNELS.plan.statusUpdate>,
    ): Promise<RuntimeIpcResult<PlanStatusUpdateData, typeof IPC_CHANNELS.plan.statusUpdate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.plan.statusUpdate, request),
  },
  tool: {
    definitionsList: (
      request: BusinessRequest<ToolDefinitionsListPayload, typeof IPC_CHANNELS.tool.definitionsList>,
    ): Promise<RuntimeIpcResult<ToolDefinitionsListData, typeof IPC_CHANNELS.tool.definitionsList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.tool.definitionsList, request),
    executionGet: (
      request: BusinessRequest<ToolExecutionGetPayload, typeof IPC_CHANNELS.tool.executionGet>,
    ): Promise<RuntimeIpcResult<ToolExecutionGetData, typeof IPC_CHANNELS.tool.executionGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.tool.executionGet, request),
  },
  approval: {
    resolve: (
      request: BusinessRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>,
    ): Promise<RuntimeIpcResult<ApprovalResolveData, typeof IPC_CHANNELS.approval.resolve>> =>
      invokeRuntimeIpc(IPC_CHANNELS.approval.resolve, request),
  },
  recovery: {
    listRecoverableRuns: (
      request: BusinessRequest<RecoverableRunListPayload, typeof IPC_CHANNELS.recovery.recoverableRunsList>,
    ): Promise<RuntimeIpcResult<RecoverableRunListData, typeof IPC_CHANNELS.recovery.recoverableRunsList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.recovery.recoverableRunsList, request),
    resume: (
      request: BusinessRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>,
    ): Promise<RuntimeIpcResult<RunResumeData, typeof IPC_CHANNELS.recovery.resume>> =>
      invokeRuntimeIpc(IPC_CHANNELS.recovery.resume, request),
    cancel: (
      request: BusinessRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>,
    ): Promise<RuntimeIpcResult<RunCancelData, typeof IPC_CHANNELS.recovery.cancel>> =>
      invokeRuntimeIpc(IPC_CHANNELS.recovery.cancel, request),
    retry: (
      request: BusinessRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>,
    ): Promise<RuntimeIpcResult<RunRetryData, typeof IPC_CHANNELS.recovery.retry>> =>
      invokeRuntimeIpc(IPC_CHANNELS.recovery.retry, request),
    restoreWorkspaceChangeSet: (
      request: BusinessRequest<WorkspaceRestorePayload, typeof IPC_CHANNELS.recovery.workspaceRestore>,
    ): Promise<RuntimeIpcResult<WorkspaceRestoreData, typeof IPC_CHANNELS.recovery.workspaceRestore>> =>
      invokeRuntimeIpc(IPC_CHANNELS.recovery.workspaceRestore, request),
  },
  project: {
    list: (
      request: BusinessRequest<ProjectListPayload, typeof IPC_CHANNELS.project.list>,
    ): Promise<RuntimeIpcResult<ProjectListData, typeof IPC_CHANNELS.project.list>> =>
      invokeRuntimeIpc(IPC_CHANNELS.project.list, request),
    useExisting: (
      request: BusinessRequest<ProjectUseExistingPayload, typeof IPC_CHANNELS.project.useExisting>,
    ): Promise<RuntimeIpcResult<ProjectUseExistingData, typeof IPC_CHANNELS.project.useExisting>> =>
      invokeRuntimeIpc(IPC_CHANNELS.project.useExisting, request),
    open: (
      request: BusinessRequest<ProjectOpenPayload, typeof IPC_CHANNELS.project.open>,
    ): Promise<RuntimeIpcResult<ProjectOpenData, typeof IPC_CHANNELS.project.open>> =>
      invokeRuntimeIpc(IPC_CHANNELS.project.open, request),
    remove: (
      request: BusinessRequest<ProjectRemovePayload, typeof IPC_CHANNELS.project.remove>,
    ): Promise<RuntimeIpcResult<ProjectRemoveData, typeof IPC_CHANNELS.project.remove>> =>
      invokeRuntimeIpc(IPC_CHANNELS.project.remove, request),
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
  memory: {
    settingsGet: (
      request: BusinessRequest<MemorySettingsGetPayload, typeof IPC_CHANNELS.memory.settingsGet>,
    ): Promise<RuntimeIpcResult<MemorySettingsData, typeof IPC_CHANNELS.memory.settingsGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.settingsGet, request),
    settingsUpdate: (
      request: BusinessRequest<MemorySettingsUpdatePayload, typeof IPC_CHANNELS.memory.settingsUpdate>,
    ): Promise<RuntimeIpcResult<MemorySettingsData, typeof IPC_CHANNELS.memory.settingsUpdate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.settingsUpdate, request),
    candidateList: (
      request: BusinessRequest<MemoryCandidateListPayload, typeof IPC_CHANNELS.memory.candidateList>,
    ): Promise<RuntimeIpcResult<MemoryCandidateListData, typeof IPC_CHANNELS.memory.candidateList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.candidateList, request),
    candidateAccept: (
      request: BusinessRequest<MemoryCandidateAcceptPayload, typeof IPC_CHANNELS.memory.candidateAccept>,
    ): Promise<RuntimeIpcResult<MemoryCandidateAcceptData, typeof IPC_CHANNELS.memory.candidateAccept>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.candidateAccept, request),
    candidateReject: (
      request: BusinessRequest<MemoryCandidateRejectPayload, typeof IPC_CHANNELS.memory.candidateReject>,
    ): Promise<RuntimeIpcResult<MemoryCandidateData, typeof IPC_CHANNELS.memory.candidateReject>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.candidateReject, request),
    candidateArchive: (
      request: BusinessRequest<MemoryCandidateArchivePayload, typeof IPC_CHANNELS.memory.candidateArchive>,
    ): Promise<RuntimeIpcResult<MemoryCandidateData, typeof IPC_CHANNELS.memory.candidateArchive>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.candidateArchive, request),
    candidateEditAndAccept: (
      request: BusinessRequest<
        MemoryCandidateEditAndAcceptPayload,
        typeof IPC_CHANNELS.memory.candidateEditAndAccept
      >,
    ): Promise<RuntimeIpcResult<
      MemoryCandidateAcceptData,
      typeof IPC_CHANNELS.memory.candidateEditAndAccept
    >> => invokeRuntimeIpc(IPC_CHANNELS.memory.candidateEditAndAccept, request),
    memoryList: (
      request: BusinessRequest<MemoryListPayload, typeof IPC_CHANNELS.memory.memoryList>,
    ): Promise<RuntimeIpcResult<MemoryListData, typeof IPC_CHANNELS.memory.memoryList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryList, request),
    memoryGet: (
      request: BusinessRequest<MemoryGetPayload, typeof IPC_CHANNELS.memory.memoryGet>,
    ): Promise<RuntimeIpcResult<MemoryGetData, typeof IPC_CHANNELS.memory.memoryGet>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryGet, request),
    memoryUpdate: (
      request: BusinessRequest<MemoryUpdatePayload, typeof IPC_CHANNELS.memory.memoryUpdate>,
    ): Promise<RuntimeIpcResult<MemoryData, typeof IPC_CHANNELS.memory.memoryUpdate>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryUpdate, request),
    memoryArchive: (
      request: BusinessRequest<MemoryStatusPayload, typeof IPC_CHANNELS.memory.memoryArchive>,
    ): Promise<RuntimeIpcResult<MemoryData, typeof IPC_CHANNELS.memory.memoryArchive>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryArchive, request),
    memoryDelete: (
      request: BusinessRequest<MemoryStatusPayload, typeof IPC_CHANNELS.memory.memoryDelete>,
    ): Promise<RuntimeIpcResult<MemoryData, typeof IPC_CHANNELS.memory.memoryDelete>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryDelete, request),
    memoryDisable: (
      request: BusinessRequest<MemoryStatusPayload, typeof IPC_CHANNELS.memory.memoryDisable>,
    ): Promise<RuntimeIpcResult<MemoryData, typeof IPC_CHANNELS.memory.memoryDisable>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryDisable, request),
    memoryEnable: (
      request: BusinessRequest<MemoryStatusPayload, typeof IPC_CHANNELS.memory.memoryEnable>,
    ): Promise<RuntimeIpcResult<MemoryData, typeof IPC_CHANNELS.memory.memoryEnable>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.memoryEnable, request),
    memorySourceRefsList: (
      request: BusinessRequest<MemorySourceRefsListPayload, typeof IPC_CHANNELS.memory.sourceRefsList>,
    ): Promise<RuntimeIpcResult<MemorySourceRefsListData, typeof IPC_CHANNELS.memory.sourceRefsList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.sourceRefsList, request),
    memoryAccessLogsList: (
      request: BusinessRequest<MemoryAccessLogsListPayload, typeof IPC_CHANNELS.memory.accessLogsList>,
    ): Promise<RuntimeIpcResult<MemoryAccessLogsListData, typeof IPC_CHANNELS.memory.accessLogsList>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.accessLogsList, request),
    recallPreview: (
      request: BusinessRequest<MemoryRecallPreviewPayload, typeof IPC_CHANNELS.memory.recallPreview>,
    ): Promise<RuntimeIpcResult<MemoryRecallPreviewData, typeof IPC_CHANNELS.memory.recallPreview>> =>
      invokeRuntimeIpc(IPC_CHANNELS.memory.recallPreview, request),
  },
  workspace: {
    files: {
      list: (
        request: BusinessRequest<WorkspaceFilesListPayload, typeof IPC_CHANNELS.workspace.files.list>,
      ): Promise<RuntimeIpcResult<WorkspaceFilesListData, typeof IPC_CHANNELS.workspace.files.list>> =>
        invokeRuntimeIpc(IPC_CHANNELS.workspace.files.list, request),
      open: (
        request: BusinessRequest<WorkspaceFileOpenPayload, typeof IPC_CHANNELS.workspace.files.open>,
      ): Promise<RuntimeIpcResult<WorkspaceFileOpenData, typeof IPC_CHANNELS.workspace.files.open>> =>
        invokeRuntimeIpc(IPC_CHANNELS.workspace.files.open, request),
    },
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
  chatStream: {
    onEvent: (callback: (event: ChatStreamEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, chatStreamEvent: ChatStreamEvent) => {
        callback(chatStreamEvent);
      };

      ipcRenderer.on(IPC_CHANNELS.chatStream.event, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.chatStream.event, listener);
    },
  },
};

