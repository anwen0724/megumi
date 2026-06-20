// Registers the single preload invoke channel and dispatches by window.megumi operation name.
import { ipcMain } from 'electron';
import type { RendererIpcRequest } from '../../shared/renderer-contracts/renderer-api';
import { handleApprovalOperation } from './handlers/approval.handler';
import { handleProjectOperation } from './handlers/project.handler';
import { handleProviderOperation } from './handlers/provider.handler';
import { handleRecoveryOperation } from './handlers/recovery.handler';
import { handleRunOperation } from './handlers/run.handler';
import { handleSessionOperation } from './handlers/session.handler';
import { handleSettingsOperation } from './handlers/settings.handler';
import { handleToolOperation } from './handlers/tool.handler';
import { handleWindowOperation } from './handlers/window.handler';
import { handleWorkspaceFilesOperation } from './handlers/workspace-files.handler';
import type { DesktopIpcContext } from './ipc-context';
import { DesktopIpcError, unavailable } from './ipc-errors';
import { fail, ok } from './ipc-result';

export function registerDesktopIpcHandlers(context: DesktopIpcContext): () => void {
  ipcMain.handle('megumi:invoke', async (_event, request: RendererIpcRequest) => {
    try {
      const operation = request.operation;
      const payload = request.payload;
      const result =
        (await handleSessionOperation(operation, payload, context)) ??
        (await handleApprovalOperation(operation, payload, context)) ??
        (await handleRecoveryOperation(operation, payload, context)) ??
        (await handleProjectOperation(operation, payload, context)) ??
        (await handleProviderOperation(operation, payload, context)) ??
        (await handleSettingsOperation(operation, payload, context)) ??
        (await handleRunOperation(operation, payload, context)) ??
        (await handleToolOperation(operation, payload, context)) ??
        (await handleWorkspaceFilesOperation(operation, payload, context)) ??
        (await handleWindowOperation(operation, payload, context)) ??
        unsupportedOperation(operation);
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  });
  return () => ipcMain.removeHandler('megumi:invoke');
}

function unsupportedOperation(operation: string): never {
  if (operation.startsWith('artifacts.') || operation.startsWith('memory.')) {
    throw unavailable(operation, 'backend is intentionally unavailable in this phase');
  }
  throw new DesktopIpcError(
    'desktop_operation_unsupported',
    `Unsupported desktop renderer operation: ${operation}`,
    { operation },
  );
}
