// Handles recovery controls by delegating retry/cancel/resume to AppApi.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';
import {
  createDesktopClientContext,
  mapRendererApprovalToAppResume,
  mapRendererCancelToAppCancel,
  mapRendererRetryToAppRetry,
} from '../renderer-protocol/app-request.mapper';
import { mapRecoverableRun } from '../renderer-protocol/history.mapper';
import { mapWorkspaceRestoreResult } from '../renderer-protocol/productization.mapper';

export async function handleRecoveryOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'recovery.listRecoverableRuns') {
    const runtime = requireRuntime(context, operation);
    return { runs: runtime.recoveryRepository.listRecoverableRuns().map(mapRecoverableRun) };
  }
  if (operation === 'recovery.resume') return context.appApi.resumeRun(mapRendererApprovalToAppResume(payload), createDesktopClientContext());
  if (operation === 'recovery.retry') return context.appApi.retryRun(mapRendererRetryToAppRetry(payload), createDesktopClientContext());
  if (operation === 'recovery.cancel') return context.appApi.cancelRun(mapRendererCancelToAppCancel(payload), createDesktopClientContext());
  if (operation === 'recovery.restoreWorkspaceChangeSet') {
    // Plan 4 placeholder was: workspace restore repository adapter is not implemented.
    // Plan 5 keeps the rule in workspace and this handler only delegates the user request.
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const changeSetId = typeof record.changeSetId === 'string' ? record.changeSetId : undefined;
    const requestedBy = record.requestedBy === 'system' ? 'system' : 'user';
    if (!changeSetId) throw unavailable(operation, 'changeSetId is required');
    const changeSet = await runtime.workspaceRepository.getChangeSet(changeSetId);
    if (!changeSet) throw unavailable(operation, 'workspace change set was not found');
    const request = await runtime.workspaceManager.createRestoreRequestForChangeSet({ changeSet, requestedBy });
    const restoreWorkspace = runtime.workspaceManager.restoreChangeSet.bind(runtime.workspaceManager);
    const result = await restoreWorkspace(changeSet, { request });
    return { restore: mapWorkspaceRestoreResult(result) };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext, operation: string) {
  if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
