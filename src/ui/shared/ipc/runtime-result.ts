import type { BusinessIpcChannel, RuntimeIpcFailure, RuntimeIpcResult } from '@megumi/renderer-contracts/ipc';
import type { RuntimeIpcError } from '@megumi/renderer-contracts/ipc';

interface IpcFailureLike {
  ok: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

type IpcResultLike = { ok: true } | IpcFailureLike;

export function getRuntimeIpcFailure<TChannel extends BusinessIpcChannel>(
  result: RuntimeIpcResult<object, TChannel>,
): RuntimeIpcFailure<TChannel> | null {
  return result.ok ? null : result;
}

export function getRuntimeIpcError(result: RuntimeIpcResult<object>): RuntimeIpcError | null {
  return result.ok ? null : result.error;
}

export function getRuntimeIpcErrorMessage(result: IpcResultLike): string {
  return result.ok ? 'Request succeeded.' : result.error.message;
}

