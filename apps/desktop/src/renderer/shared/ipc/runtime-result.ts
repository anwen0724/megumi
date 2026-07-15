import type { BusinessIpcChannel, RuntimeIpcFailure, RuntimeIpcResult } from '@megumi/desktop/main/ipc/contracts';
import type { RuntimeIpcError } from '@megumi/desktop/main/ipc/errors';
import { rendererError, type RendererErrorDescriptor } from '../i18n/error-localization';

export function getRuntimeIpcFailure<TChannel extends BusinessIpcChannel>(
  result: RuntimeIpcResult<object, TChannel>,
): RuntimeIpcFailure<TChannel> | null {
  return result.ok ? null : result;
}

export function getRuntimeIpcError(result: RuntimeIpcResult<object>): RuntimeIpcError | null {
  return result.ok ? null : result.data;
}

export function getRuntimeIpcErrorMessage(result: RuntimeIpcResult<object>): string {
  return result.ok ? 'Request succeeded.' : result.data.message;
}

export function getRendererRuntimeIpcError(
  result: RuntimeIpcResult<object>,
  fallbackCode: string,
): RendererErrorDescriptor {
  if (result.ok) return rendererError(fallbackCode);
  return rendererError(result.data.code, result.data.message, undefined, fallbackCode);
}
