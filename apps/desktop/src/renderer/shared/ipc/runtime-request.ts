import type { BusinessIpcChannel, RuntimeIpcRequest } from '@megumi/desktop/main/ipc/contracts';
import {
  buildRuntimeContext,
  generateRuntimeTraceId,
  type RuntimeContext,
} from '@megumi/product/host-interface';
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
  return buildRuntimeContext({
    requestId: input.requestId,
    traceId: input.traceId ?? generateRuntimeTraceId(),
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
