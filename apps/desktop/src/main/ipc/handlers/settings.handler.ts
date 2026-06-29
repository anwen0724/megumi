// Adapts renderer settings IPC calls to the Main-owned app settings service.
// This handler never reads or writes renderer-local storage.
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import {
  SettingsGetRequestSchema,
  SettingsUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { HostSettingsController } from '@megumi/coding-agent/host-interface';
import { createIpcRequestHandler } from '../create-ipc-request-handler';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import type { DesktopIpcMain } from '../../shell/electron-ipc-main-host';

export type SettingsHandlersService = Pick<HostSettingsController, 'get' | 'update'>;

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
    handle: () => settingsService.get(),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.update,
    requestSchema: SettingsUpdateRequestSchema,
    logger,
    handle: (request) => settingsService.update(request.payload),
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
