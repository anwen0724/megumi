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
  runtime: {
    event: 'runtime:event',
  },
} as const;

type ValueOf<T> = T[keyof T];
type NestedValueOf<T> = ValueOf<{ [K in keyof T]: ValueOf<T[K]> }>;

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
  IPC_CHANNELS.runtime.event,
] as const;

export function isIpcChannel(value: string): value is IpcChannel {
  return (ALL_IPC_CHANNELS as readonly string[]).includes(value);
}
