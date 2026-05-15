import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type {
  BusinessIpcChannel,
  RuntimeIpcRequest,
  RuntimeIpcResult,
} from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import { createRuntimeDebugId } from '@megumi/shared/runtime-context';
import type {
  AgentContextBaselineGetData,
  AgentContextBaselineGetPayload,
  AgentContextSourcesListData,
  AgentContextSourcesListPayload,
  AgentPlanByRunGetData,
  AgentPlanByRunGetPayload,
  AgentPlanStatusUpdateData,
  AgentPlanStatusUpdatePayload,
  AgentRunStartData,
  AgentRunStartPayload,
  AgentSessionCreateData,
  AgentSessionCreatePayload,
  AgentSessionListData,
  AgentSessionListPayload,
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
  agent: {
    session: {
      create: (
        request: BusinessRequest<AgentSessionCreatePayload, typeof IPC_CHANNELS.agent.session.create>,
      ): Promise<RuntimeIpcResult<AgentSessionCreateData, typeof IPC_CHANNELS.agent.session.create>> =>
        invokeRuntimeIpc(IPC_CHANNELS.agent.session.create, request),
      list: (
        request: BusinessRequest<AgentSessionListPayload, typeof IPC_CHANNELS.agent.session.list>,
      ): Promise<RuntimeIpcResult<AgentSessionListData, typeof IPC_CHANNELS.agent.session.list>> =>
        invokeRuntimeIpc(IPC_CHANNELS.agent.session.list, request),
    },
    run: {
      start: (
        request: BusinessRequest<AgentRunStartPayload, typeof IPC_CHANNELS.agent.run.start>,
      ): Promise<RuntimeIpcResult<AgentRunStartData, typeof IPC_CHANNELS.agent.run.start>> =>
        invokeRuntimeIpc(IPC_CHANNELS.agent.run.start, request),
    },
    context: {
      baselineGet: (
        request: BusinessRequest<
          AgentContextBaselineGetPayload,
          typeof IPC_CHANNELS.agent.context.baselineGet
        >,
      ): Promise<RuntimeIpcResult<
        AgentContextBaselineGetData,
        typeof IPC_CHANNELS.agent.context.baselineGet
      >> => invokeRuntimeIpc(IPC_CHANNELS.agent.context.baselineGet, request),
      sourcesList: (
        request: BusinessRequest<
          AgentContextSourcesListPayload,
          typeof IPC_CHANNELS.agent.context.sourcesList
        >,
      ): Promise<RuntimeIpcResult<
        AgentContextSourcesListData,
        typeof IPC_CHANNELS.agent.context.sourcesList
      >> => invokeRuntimeIpc(IPC_CHANNELS.agent.context.sourcesList, request),
    },
    plan: {
      byRunGet: (
        request: BusinessRequest<
          AgentPlanByRunGetPayload,
          typeof IPC_CHANNELS.agent.plan.byRunGet
        >,
      ): Promise<RuntimeIpcResult<
        AgentPlanByRunGetData,
        typeof IPC_CHANNELS.agent.plan.byRunGet
      >> => invokeRuntimeIpc(IPC_CHANNELS.agent.plan.byRunGet, request),
      statusUpdate: (
        request: BusinessRequest<
          AgentPlanStatusUpdatePayload,
          typeof IPC_CHANNELS.agent.plan.statusUpdate
        >,
      ): Promise<RuntimeIpcResult<
        AgentPlanStatusUpdateData,
        typeof IPC_CHANNELS.agent.plan.statusUpdate
      >> => invokeRuntimeIpc(IPC_CHANNELS.agent.plan.statusUpdate, request),
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
};
