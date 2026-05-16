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
  chat: {
    start: 'chat:start',
    cancel: 'chat:cancel',
  },
  agent: {
    session: {
      create: 'agent:session:create',
      list: 'agent:session:list',
    },
    run: {
      start: 'agent:run:start',
    },
    context: {
      baselineGet: 'agent:context:baseline:get',
      sourcesList: 'agent:context:sources:list',
    },
    plan: {
      byRunGet: 'agent:plan:by-run:get',
      statusUpdate: 'agent:plan:status:update',
    },
    tool: {
      definitionsList: 'agent:tool:definitions:list',
      callGet: 'agent:tool:call:get',
    },
    approval: {
      resolve: 'agent:approval:resolve',
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
  IPC_CHANNELS.chat.start,
  IPC_CHANNELS.chat.cancel,
  IPC_CHANNELS.agent.session.create,
  IPC_CHANNELS.agent.session.list,
  IPC_CHANNELS.agent.run.start,
  IPC_CHANNELS.agent.context.baselineGet,
  IPC_CHANNELS.agent.context.sourcesList,
  IPC_CHANNELS.agent.plan.byRunGet,
  IPC_CHANNELS.agent.plan.statusUpdate,
  IPC_CHANNELS.agent.tool.definitionsList,
  IPC_CHANNELS.agent.tool.callGet,
  IPC_CHANNELS.agent.approval.resolve,
  IPC_CHANNELS.runtime.event,
] as const;

export function isIpcChannel(value: string): value is IpcChannel {
  return (ALL_IPC_CHANNELS as readonly string[]).includes(value);
}
