import type { BusinessIpcChannel, RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import {
  createRuntimeContext,
  createRuntimeTraceId,
  type RuntimeContext,
} from '@megumi/shared/runtime-context';
import { rendererRuntimeOperationNameFromChannel } from './runtime-operation-name';

export interface CreateRendererRuntimeIpcRequestOptions {
  requestId?: string;
  traceId?: string;
  debugId?: string;
  operationName?: string;
  createdAt?: string;
}

export function createRendererRuntimeIpcRequest<TPayload, TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  payload: TPayload,
  options: CreateRendererRuntimeIpcRequestOptions = {},
): RuntimeIpcRequest<TPayload, TChannel> {
  const requestId = options.requestId ?? createRendererRequestId();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const context = createRendererRuntimeContext(channel, {
    requestId,
    traceId: options.traceId,
    debugId: options.debugId,
    operationName: options.operationName,
    createdAt,
  });

  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt,
      source: 'renderer',
    },
    context,
  };
}

function createRendererRuntimeContext<TChannel extends BusinessIpcChannel>(
  channel: TChannel,
  input: {
    requestId: string;
    traceId?: string;
    debugId?: string;
    operationName?: string;
    createdAt: string;
  },
): RuntimeContext {
  return createRuntimeContext({
    requestId: input.requestId,
    traceId: input.traceId ?? createRuntimeTraceId(),
    debugId: input.debugId,
    operationName: input.operationName ?? rendererRuntimeOperationNameFromChannel(channel),
    source: 'renderer',
    createdAt: input.createdAt,
  });
}

function createRendererRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ipc-${crypto.randomUUID()}`;
  }

  return `ipc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
