// Adapts renderer settings IPC calls to the Main-owned app settings service.
// This handler never reads or writes renderer-local storage.
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import {
  SettingsGetRequestSchema,
  SettingsUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { AppSettingsRaw, AppSettingsResolved } from '@megumi/shared/settings';
import { createIpcRequestHandler } from '../create-ipc-request-handler';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';
import type { DesktopIpcMain } from '../../host/electron-ipc-main-host';

export interface SettingsHandlersService {
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
}

export interface RegisterSettingsHandlersOptions {
  ipcMain: DesktopIpcMain;
  settingsService: SettingsHandlersService;
  logger?: RuntimeLogger;
}

export function registerSettingsHandlers(options: RegisterSettingsHandlersOptions): void {
  const { ipcMain, settingsService, logger } = options;

  ipcMain.handle(IPC_CHANNELS.settings.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.get,
    requestSchema: SettingsGetRequestSchema,
    logger,
    handle: () => ({ settings: settingsService.getResolvedSettings() }),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.update,
    requestSchema: SettingsUpdateRequestSchema,
    logger,
    handle: (request) => ({ settings: settingsService.updateSettings(request.payload) }),
    mapError: mapSettingsIpcError,
  }));
}

function mapSettingsIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Settings service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
