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
    completeSetup: 'settings:complete-setup',
    providerList: 'provider:list',
    providerUpdate: 'provider:update',
    providerDelete: 'provider:delete',
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
    sessionHydrationGet: 'session:hydration:get',
    sessionContextUsageGet: 'session:context-usage:get',
    branchDraftCreate: 'session:branch-draft:create',
    branchDraftCancel: 'session:branch-draft:cancel',
    runListBySession: 'run:list-by-session',
    runEventsList: 'run:events:list',
  },
  skill: {
    list: 'skill:list',
    get: 'skill:get',
    enable: 'skill:enable',
    disable: 'skill:disable',
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
  },
  observability: {
    list: 'observability:list',
    get: 'observability:get',
    bundle: 'observability:bundle',
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
  IPC_CHANNELS.settings.completeSetup,
  IPC_CHANNELS.settings.providerList,
  IPC_CHANNELS.settings.providerUpdate,
  IPC_CHANNELS.settings.providerDelete,
  IPC_CHANNELS.settings.providerSetApiKey,
  IPC_CHANNELS.settings.providerDeleteApiKey,
  IPC_CHANNELS.chat.commandSuggestions,
  IPC_CHANNELS.chat.sessionCreate,
  IPC_CHANNELS.chat.sessionList,
  IPC_CHANNELS.chat.sessionMessageList,
  IPC_CHANNELS.chat.sessionMessageSend,
  IPC_CHANNELS.chat.sessionMessageCancel,
  IPC_CHANNELS.chat.sessionTimelineList,
  IPC_CHANNELS.chat.sessionHydrationGet,
  IPC_CHANNELS.chat.sessionContextUsageGet,
  IPC_CHANNELS.chat.branchDraftCreate,
  IPC_CHANNELS.chat.branchDraftCancel,
  IPC_CHANNELS.chat.runListBySession,
  IPC_CHANNELS.chat.runEventsList,
  IPC_CHANNELS.skill.list,
  IPC_CHANNELS.skill.get,
  IPC_CHANNELS.skill.enable,
  IPC_CHANNELS.skill.disable,
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
  IPC_CHANNELS.observability.list,
  IPC_CHANNELS.observability.get,
  IPC_CHANNELS.observability.bundle,
  IPC_CHANNELS.runtime.event,
] as const;

export function isIpcChannel(value: string): value is IpcChannel {
  return (ALL_IPC_CHANNELS as readonly string[]).includes(value);
}
