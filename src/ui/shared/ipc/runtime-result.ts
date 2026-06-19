import type { BusinessIpcChannel, RuntimeIpcFailure, RuntimeIpcResult } from '@megumi/renderer-contracts/ipc';
import type { RuntimeIpcError } from '@megumi/renderer-contracts/ipc';

export function getRuntimeIpcFailure<TChannel extends BusinessIpcChannel>(
  result: RuntimeIpcResult<object, TChannel>,
): RuntimeIpcFailure<TChannel> | null {
  return result.ok ? null : result;
}

export function getRuntimeIpcError(result: RuntimeIpcResult<object>): RuntimeIpcError | null {
  return result.ok ? null : result.error;
}

export function getRuntimeIpcErrorMessage(result: RuntimeIpcResult<object>): string {
  return result.ok ? 'Request succeeded.' : result.error.message;
}

