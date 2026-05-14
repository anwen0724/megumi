import type { BusinessIpcChannel, RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';

export interface CreateRendererRuntimeIpcRequestOptions {
  requestId?: string;
}

export function createRendererRuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  payload: TPayload,
  options: CreateRendererRuntimeIpcRequestOptions = {},
): RuntimeIpcRequest<TPayload, TChannel> {
  return {
    requestId: options.requestId ?? createRendererRequestId(),
    payload,
    meta: {
      channel,
      createdAt: new Date().toISOString(),
      source: 'renderer',
    },
  };
}

function createRendererRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ipc-${crypto.randomUUID()}`;
  }

  return `ipc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
