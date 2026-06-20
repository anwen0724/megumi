// Registers the single preload invoke channel and dispatches by window.megumi operation name.
import { ipcMain } from 'electron';
import type { RendererIpcRequest } from '../../shared/renderer-contracts/renderer-api';
import { handleApprovalOperation } from './approval.handler';
import { handleProjectOperation } from './project.handler';
import { handleProviderOperation } from './provider.handler';
import { handleRecoveryOperation } from './recovery.handler';
import { handleRunOperation } from './run.handler';
import { handleSessionOperation } from './session.handler';
import { handleSettingsOperation } from './settings.handler';
import { handleToolOperation } from './tool.handler';
import { handleWindowOperation } from './window.handler';
import { handleWorkspaceFilesOperation } from './workspace-files.handler';
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
