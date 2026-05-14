import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type {
  BusinessIpcChannel,
  RuntimeIpcRequest,
  RuntimeIpcResult,
} from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  ChatCancelData,
  ChatCancelPayload,
  ChatStartData,
  ChatStartPayload,
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderListPayload,
  ProviderUpdatePayload,
} from '@megumi/shared/ipc-schemas';

type BusinessRequest<TPayload, TChannel extends BusinessIpcChannel> = RuntimeIpcRequest<TPayload, TChannel>;
type EmptyData = Record<string, never>;

async function invokeRuntimeIpc<TPayload, TData extends object, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  request: BusinessRequest<TPayload, TChannel>,
): Promise<RuntimeIpcResult<TData, TChannel>> {
  try {
    return await ipcRenderer.invoke(channel, request) as RuntimeIpcResult<TData, TChannel>;
  } catch {
    return {
      ok: false,
      error: createPreloadInvokeError(),
      meta: {
        requestId: request.requestId,
        channel,
        handledAt: new Date().toISOString(),
      },
    };
  }
}

function createPreloadInvokeError(): RuntimeIpcError {
  return {
    code: 'ipc_invoke_failed',
    message: 'Megumi could not reach the main process.',
    severity: 'error',
    retryable: true,
    source: 'preload',
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
  chat: {
    start: (
      request: BusinessRequest<ChatStartPayload, typeof IPC_CHANNELS.chat.start>,
    ): Promise<RuntimeIpcResult<ChatStartData, typeof IPC_CHANNELS.chat.start>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.start, request),
    cancel: (
      request: BusinessRequest<ChatCancelPayload, typeof IPC_CHANNELS.chat.cancel>,
    ): Promise<RuntimeIpcResult<ChatCancelData, typeof IPC_CHANNELS.chat.cancel>> =>
      invokeRuntimeIpc(IPC_CHANNELS.chat.cancel, request),
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
