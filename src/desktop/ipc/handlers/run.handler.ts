// Handles run query bridge operations for renderer hydration.
import type { DesktopIpcContext } from '../ipc-context';
import { unavailable } from '../ipc-errors';
import { mapRuntimeEventHistory, mapRunToRendererSummary } from '../../renderer-protocol/history.mapper';
import { unwrapRendererRuntimePayload } from '../runtime-request-payload';
import type { RendererRuntimeEventHistoryDto } from '../../../shared';

export async function handleRunOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'run.listBySession') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
    if (!sessionId) throw unavailable(operation, 'sessionId is required');
    return { runs: context.runtime.sessionRepository.listRunRecords(sessionId).map(mapRunToRendererSummary) };
  }
  if (operation === 'run.events.list') {
    if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const runId = typeof record.runId === 'string' ? record.runId : undefined;
    if (!runId) throw unavailable(operation, 'runId is required');
    return {
      events: context.runtime.runtimeEventRepository
        .listEventsByRun(runId)
        .map(mapRuntimeEventHistory)
        .filter((event): event is RendererRuntimeEventHistoryDto => Boolean(event)),
    };
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
