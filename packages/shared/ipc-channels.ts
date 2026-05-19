export const IPC_CHANNELS = {
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
  },
  provider: {
    list: 'provider:list',
    update: 'provider:update',
    setApiKey: 'provider:set-api-key',
    deleteApiKey: 'provider:delete-api-key',
  },
  session: {
    create: 'session:create',
    list: 'session:list',
    message: {
      send: 'session:message:send',
      cancel: 'session:message:cancel',
    },
  },
  run: {
    events: {
      list: 'run:events:list',
    },
  },
  runContext: {
    baselineGet: 'run-context:baseline:get',
    sourcesList: 'run-context:sources:list',
  },
  plan: {
    byRunGet: 'plan:by-run:get',
    statusUpdate: 'plan:status:update',
  },
  tool: {
    definitionsList: 'tool:definitions:list',
    callGet: 'tool:call:get',
  },
  approval: {
    resolve: 'approval:resolve',
  },
  recovery: {
    recoverableRunsList: 'recovery:recoverable-runs:list',
    resume: 'recovery:resume',
    cancel: 'recovery:cancel',
    retry: 'recovery:retry',
  },
  project: {
    list: 'project:list',
    useExisting: 'project:use-existing',
    open: 'project:open',
    remove: 'project:remove',
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
  memory: {
    settingsGet: 'memory:settings:get',
    settingsUpdate: 'memory:settings:update',
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
  workspace: {
    files: {
      list: 'workspace:files:list',
    },
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
  IPC_CHANNELS.provider.list,
  IPC_CHANNELS.provider.update,
  IPC_CHANNELS.provider.setApiKey,
  IPC_CHANNELS.provider.deleteApiKey,
  IPC_CHANNELS.session.create,
  IPC_CHANNELS.session.list,
  IPC_CHANNELS.session.message.send,
  IPC_CHANNELS.session.message.cancel,
  IPC_CHANNELS.run.events.list,
  IPC_CHANNELS.runContext.baselineGet,
  IPC_CHANNELS.runContext.sourcesList,
  IPC_CHANNELS.plan.byRunGet,
  IPC_CHANNELS.plan.statusUpdate,
  IPC_CHANNELS.tool.definitionsList,
  IPC_CHANNELS.tool.callGet,
  IPC_CHANNELS.approval.resolve,
  IPC_CHANNELS.recovery.recoverableRunsList,
  IPC_CHANNELS.recovery.resume,
  IPC_CHANNELS.recovery.cancel,
  IPC_CHANNELS.recovery.retry,
  IPC_CHANNELS.project.list,
  IPC_CHANNELS.project.useExisting,
  IPC_CHANNELS.project.open,
  IPC_CHANNELS.project.remove,
  IPC_CHANNELS.artifacts.listByRun,
  IPC_CHANNELS.artifacts.listBySession,
  IPC_CHANNELS.artifacts.get,
  IPC_CHANNELS.artifacts.versionGet,
  IPC_CHANNELS.artifacts.versionCreate,
  IPC_CHANNELS.artifacts.statusUpdate,
  IPC_CHANNELS.artifacts.reference,
  IPC_CHANNELS.memory.settingsGet,
  IPC_CHANNELS.memory.settingsUpdate,
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
  IPC_CHANNELS.workspace.files.list,
  IPC_CHANNELS.runtime.event,
] as const;

export function isIpcChannel(value: string): value is IpcChannel {
  return (ALL_IPC_CHANNELS as readonly string[]).includes(value);
}
