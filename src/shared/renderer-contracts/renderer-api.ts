// Owns the renderer-facing window.megumi API contract consumed by src/ui and implemented by src/desktop preload.
import type {
  SessionMessageSendAckDto,
  SessionMessageSendRequestDto,
} from './session-message';
import type { RendererChatStreamEventDto } from './chat-stream';
import type { RendererRuntimeEventDto } from './runtime';
import type {
  ApprovalResolvePayload,
  BranchDraftCancelData,
  BranchDraftCancelPayload,
  BranchDraftCreateData,
  BranchDraftCreatePayload,
  BusinessIpcChannel,
  DeferredBackendUnavailableData,
  EmptyRendererPayload,
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderListPayload,
  ProviderMutationData,
  ProviderUpdatePayload,
  ProjectListData,
  ProjectListPayload,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
  ProjectUseExistingPayload,
  RecoverableRunListData,
  RendererOperationRequest,
  RunCancelData,
  RunCancelPayload,
  RunContextGetPayload,
  RunEventsListData,
  RunEventsListPayload,
  RunListBySessionData,
  RunListBySessionPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
  SessionListData,
  SessionListPayload,
  SessionMessageCancelData,
  SessionMessageCancelPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
  SettingsData,
  SettingsGetPayload,
  SettingsUpdatePayload,
  ToolExecutionGetData,
  ToolExecutionGetPayload,
  ToolListData,
  ToolListPayload,
  WorkspaceChangesListData,
  WorkspaceChangesListPayload,
  WorkspaceRestoreData,
} from './ipc';
import { IPC_CHANNELS } from './ipc';
import type {
  WorkspaceFileOpenData,
  WorkspaceFileOpenPayload,
  WorkspaceFilesListData,
  WorkspaceFilesListPayload,
} from './workspace';

export type { RendererChatStreamEventDto, RendererRuntimeEventDto };
export type { RendererThemeName } from './ipc';

export interface RendererIpcRequest<TPayload = unknown> {
  operation: string;
  payload?: TPayload;
}

export interface RendererIpcSuccess<TResult = unknown> {
  ok: true;
  data: TResult;
}

export interface RendererIpcFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type RendererIpcResult<TResult = unknown> = RendererIpcSuccess<TResult> | RendererIpcFailure;

export type RendererUnsubscribe = () => void;
type OperationRequest<TPayload, TChannel extends BusinessIpcChannel> = RendererOperationRequest<TPayload, TChannel>;

export type RendererSettingsData = SettingsData;

export interface MegumiRendererApi {
  windowControls: {
    minimize(): Promise<RendererIpcResult<void>>;
    toggleMaximize(): Promise<RendererIpcResult<void>>;
    close(): Promise<RendererIpcResult<void>>;
  };
  project: {
    list(payload?: OperationRequest<ProjectListPayload, typeof IPC_CHANNELS.project.list>): Promise<RendererIpcResult<ProjectListData>>;
    useExisting(payload: OperationRequest<ProjectUseExistingPayload, typeof IPC_CHANNELS.project.useExisting>): Promise<RendererIpcResult<ProjectUseExistingData>>;
    open(payload: OperationRequest<ProjectOpenPayload, typeof IPC_CHANNELS.project.open>): Promise<RendererIpcResult<ProjectOpenData>>;
    remove(payload: OperationRequest<ProjectRemovePayload, typeof IPC_CHANNELS.project.remove>): Promise<RendererIpcResult<ProjectRemoveData>>;
  };
  provider: {
    list(payload?: OperationRequest<ProviderListPayload, typeof IPC_CHANNELS.provider.list>): Promise<RendererIpcResult<ProviderListData>>;
    update(payload: OperationRequest<ProviderUpdatePayload, typeof IPC_CHANNELS.provider.update>): Promise<RendererIpcResult<ProviderMutationData>>;
    setApiKey(payload: OperationRequest<ProviderApiKeyPayload, typeof IPC_CHANNELS.provider.setApiKey>): Promise<RendererIpcResult<ProviderMutationData>>;
    deleteApiKey(payload: OperationRequest<ProviderDeleteApiKeyPayload, typeof IPC_CHANNELS.provider.deleteApiKey>): Promise<RendererIpcResult<ProviderMutationData>>;
  };
  settings: {
    get(payload?: OperationRequest<SettingsGetPayload, typeof IPC_CHANNELS.settings.get>): Promise<RendererIpcResult<SettingsData>>;
    update(payload: OperationRequest<SettingsUpdatePayload, typeof IPC_CHANNELS.settings.update>): Promise<RendererIpcResult<SettingsData>>;
  };
  session: {
    list(payload?: OperationRequest<SessionListPayload, typeof IPC_CHANNELS.session.list>): Promise<RendererIpcResult<SessionListData>>;
    timeline: {
      list(payload: OperationRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.session.timeline.list>): Promise<RendererIpcResult<SessionTimelineListData>>;
    };
    message: {
      send(payload: SessionMessageSendRequestDto): Promise<RendererIpcResult<SessionMessageSendAckDto>>;
      cancel(payload: OperationRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.message.cancel>): Promise<RendererIpcResult<SessionMessageCancelData>>;
    };
    branchDraft: {
      create(payload: OperationRequest<BranchDraftCreatePayload, typeof IPC_CHANNELS.session.branchDraft.create>): Promise<RendererIpcResult<BranchDraftCreateData>>;
      cancel(payload: OperationRequest<BranchDraftCancelPayload, typeof IPC_CHANNELS.session.branchDraft.cancel>): Promise<RendererIpcResult<BranchDraftCancelData>>;
    };
  };
  run: {
    listBySession(payload: OperationRequest<RunListBySessionPayload, typeof IPC_CHANNELS.run.listBySession>): Promise<RendererIpcResult<RunListBySessionData>>;
    events: {
      list(payload: OperationRequest<RunEventsListPayload, typeof IPC_CHANNELS.run.events.list>): Promise<RendererIpcResult<RunEventsListData>>;
    };
  };
  runtime: {
    onEvent(callback: (event: RendererRuntimeEventDto) => void): RendererUnsubscribe;
  };
  chatStream: {
    onEvent(callback: (event: RendererChatStreamEventDto) => void): RendererUnsubscribe;
  };
  approval: {
    resolve(payload: OperationRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>): Promise<RendererIpcResult<SessionMessageSendAckDto>>;
  };
  recovery: {
    listRecoverableRuns(payload?: OperationRequest<EmptyRendererPayload, typeof IPC_CHANNELS.recovery.recoverableRunsList>): Promise<RendererIpcResult<RecoverableRunListData>>;
    resume(payload: OperationRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>): Promise<RendererIpcResult<RunResumeData>>;
    retry(payload: OperationRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>): Promise<RendererIpcResult<RunRetryData>>;
    cancel(payload: OperationRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>): Promise<RendererIpcResult<RunCancelData>>;
    restoreWorkspaceChangeSet(payload: OperationRequest<{ changeSetId: string; requestedBy?: 'user' | 'system'; metadata?: Record<string, unknown> }, typeof IPC_CHANNELS.recovery.workspaceRestore>): Promise<RendererIpcResult<WorkspaceRestoreData>>;
  };
  workspace: {
    files: {
      list(payload: OperationRequest<WorkspaceFilesListPayload, typeof IPC_CHANNELS.workspace.files.list>): Promise<RendererIpcResult<WorkspaceFilesListData>>;
      open(payload: OperationRequest<WorkspaceFileOpenPayload, typeof IPC_CHANNELS.workspace.files.open>): Promise<RendererIpcResult<WorkspaceFileOpenData>>;
    };
    changes: {
      list(payload: OperationRequest<WorkspaceChangesListPayload, typeof IPC_CHANNELS.workspace.changes.list>): Promise<RendererIpcResult<WorkspaceChangesListData>>;
    };
  };
  runContext: {
    get(payload?: OperationRequest<RunContextGetPayload, typeof IPC_CHANNELS.runContext.baselineGet>): Promise<RendererIpcResult<DeferredBackendUnavailableData>>;
  };
  plan: {
    list(payload?: OperationRequest<EmptyRendererPayload, typeof IPC_CHANNELS.plan.byRunGet>): Promise<RendererIpcResult<DeferredBackendUnavailableData>>;
  };
  tool: {
    list(payload?: OperationRequest<ToolListPayload, typeof IPC_CHANNELS.tool.definitionsList>): Promise<RendererIpcResult<ToolListData>>;
    execution: {
      get(payload: OperationRequest<ToolExecutionGetPayload, typeof IPC_CHANNELS.tool.executionGet>): Promise<RendererIpcResult<ToolExecutionGetData>>;
    };
  };
  artifacts: {
    list(payload?: OperationRequest<EmptyRendererPayload, typeof IPC_CHANNELS.artifacts.listBySession>): Promise<RendererIpcResult<DeferredBackendUnavailableData>>;
  };
  memory: {
    getSettings(payload?: OperationRequest<EmptyRendererPayload, typeof IPC_CHANNELS.memory.settingsGet>): Promise<RendererIpcResult<DeferredBackendUnavailableData>>;
  };
}
