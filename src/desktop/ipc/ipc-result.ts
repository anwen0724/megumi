// Normalizes IPC handler responses for the renderer bridge.
import type { RendererIpcResult } from '../dto/renderer-api';

export function ok<T>(value: T): RendererIpcResult<T> {
  return { ok: true, value };
}

export function fail(error: unknown): RendererIpcResult<never> {
  const known = error as Partial<Error> & { code?: unknown; details?: unknown };
  const message = error instanceof Error ? error.message : 'Unknown desktop IPC error';
  const code = typeof known.code === 'string' ? known.code : 'desktop_ipc_error';
  const details = known.details && typeof known.details === 'object' && !Array.isArray(known.details)
    ? known.details as Record<string, unknown>
    : undefined;
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}
