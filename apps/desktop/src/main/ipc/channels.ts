/*
 * Electron IPC channel names owned by the desktop shell.
 */
export const IPC_CHANNELS = {
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    providerList: 'provider:list',
    providerUpdate: 'provider:update',
    providerSetApiKey: 'provider:set-api-key',
    providerDeleteApiKey: 'provider:delete-api-key',
  },
  chat: {
    commandSuggestions: 'command:suggestions',
    sessionCreate: 'session:create',
    sessionList: 'session:list',
    sessionMessageList: 'session:message:list',
    sessionMessageSend: 'session:message:send',
    sessionMessageCancel: 'session:message:cancel',
    sessionTimelineList: 'session:timeline:list',
    branchDraftCreate: 'session:branch-draft:create',
    branchDraftCancel: 'session:branch-draft:cancel',
    runListBySession: 'run:list-by-session',
    runEventsList: 'run:events:list',
  },
  approval: {
    resolve: 'approval:resolve',
  },
  workspace: {
    projectList: 'project:list',
    projectUseExisting: 'project:use-existing',
    projectOpen: 'project:open',
    projectRemove: 'project:remove',
    filesList: 'workspace:files:list',
    filesOpen: 'workspace:files:open',
  },
  artifacts: {
    listByRun: 'artifacts:list-by-run',
    listBySession: 'artifacts:list-by-session',
    get: 'artifacts:get',
    versionGet: 'artifacts:version:get',
    versionCreate: 'artifacts:version:create',
    statusUpdate: 'artifacts:status:update',
    reference: 'artifacts:reference',
    planByRunGet: 'plan:by-run:get',
    planStatusUpdate: 'plan:status:update',
  },
  memory: {
    candidateList: 'memory:candidate:list',
    candidateAccept: 'memory:candidate:accept',
    candidateReject: 'memory:candidate:reject',
    candidateArchive: 'memory:candidate:archive',
    candidateEditAndAccept: 'memory:candidate:edit-and-accept',
    memoryList: 'memory:memory:list',
    memoryGet: 'memory:memory:get',
    memoryUpdate: 'memory:memory:update',
    memoryArchive: 'memory:memory:archive',
    memoryDelete: 'memory:memory:delete',
    memoryDisable: 'memory:memory:disable',
    memoryEnable: 'memory:memory:enable',
    sourceRefsList: 'memory:source-refs:list',
    accessLogsList: 'memory:access-logs:list',
    recallPreview: 'memory:recall-preview',
  },
  chatStream: {
    event: 'chat-stream:event',
  },
  runtime: {
    event: 'runtime:event',
  },
} as const;

type ValueOf<T> = T[keyof T];
type NestedValueOf<T> = T extends string
  ? T
  : ValueOf<{ [K in keyof T]: NestedValueOf<T[K]> }>;

export type IpcChannel = NestedValueOf<typeof IPC_CHANNELS>;

const ALL_IPC_CHANNELS = [
  IPC_CHANNELS.window.minimize,
  IPC_CHANNELS.window.toggleMaximize,
  IPC_CHANNELS.window.close,
  IPC_CHANNELS.settings.get,
  IPC_CHANNELS.settings.update,
  IPC_CHANNELS.settings.providerList,
  IPC_CHANNELS.settings.providerUpdate,
  IPC_CHANNELS.settings.providerSetApiKey,
  IPC_CHANNELS.settings.providerDeleteApiKey,
  IPC_CHANNELS.chat.commandSuggestions,
  IPC_CHANNELS.chat.sessionCreate,
  IPC_CHANNELS.chat.sessionList,
  IPC_CHANNELS.chat.sessionMessageList,
  IPC_CHANNELS.chat.sessionMessageSend,
  IPC_CHANNELS.chat.sessionMessageCancel,
  IPC_CHANNELS.chat.sessionTimelineList,
  IPC_CHANNELS.chat.branchDraftCreate,
  IPC_CHANNELS.chat.branchDraftCancel,
  IPC_CHANNELS.chat.runListBySession,
  IPC_CHANNELS.chat.runEventsList,
  IPC_CHANNELS.approval.resolve,
  IPC_CHANNELS.workspace.projectList,
  IPC_CHANNELS.workspace.projectUseExisting,
  IPC_CHANNELS.workspace.projectOpen,
  IPC_CHANNELS.workspace.projectRemove,
  IPC_CHANNELS.workspace.filesList,
  IPC_CHANNELS.workspace.filesOpen,
  IPC_CHANNELS.artifacts.listByRun,
  IPC_CHANNELS.artifacts.listBySession,
  IPC_CHANNELS.artifacts.get,
  IPC_CHANNELS.artifacts.versionGet,
  IPC_CHANNELS.artifacts.versionCreate,
  IPC_CHANNELS.artifacts.statusUpdate,
  IPC_CHANNELS.artifacts.reference,
  IPC_CHANNELS.artifacts.planByRunGet,
  IPC_CHANNELS.artifacts.planStatusUpdate,
  IPC_CHANNELS.memory.candidateList,
  IPC_CHANNELS.memory.candidateAccept,
  IPC_CHANNELS.memory.candidateReject,
  IPC_CHANNELS.memory.candidateArchive,
  IPC_CHANNELS.memory.candidateEditAndAccept,
  IPC_CHANNELS.memory.memoryList,
  IPC_CHANNELS.memory.memoryGet,
  IPC_CHANNELS.memory.memoryUpdate,
  IPC_CHANNELS.memory.memoryArchive,
  IPC_CHANNELS.memory.memoryDelete,
  IPC_CHANNELS.memory.memoryDisable,
  IPC_CHANNELS.memory.memoryEnable,
  IPC_CHANNELS.memory.sourceRefsList,
  IPC_CHANNELS.memory.accessLogsList,
  IPC_CHANNELS.memory.recallPreview,
  IPC_CHANNELS.chatStream.event,
  IPC_CHANNELS.runtime.event,
] as const;

export function isIpcChannel(value: string): value is IpcChannel {
  return (ALL_IPC_CHANNELS as readonly string[]).includes(value);
}
