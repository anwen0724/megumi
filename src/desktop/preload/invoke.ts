// Wraps ipcRenderer.invoke behind the renderer-facing result envelope.
import { ipcRenderer } from 'electron';
import type { RendererIpcRequest, RendererIpcResult } from '../dto/renderer-api';

export async function invokeRendererOperation<TResult = unknown>(
  operation: string,
  payload?: unknown,
): Promise<RendererIpcResult<TResult>> {
  return ipcRenderer.invoke('megumi:invoke', { operation, payload } satisfies RendererIpcRequest);
}
