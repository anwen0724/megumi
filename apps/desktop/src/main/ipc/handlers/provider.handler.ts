// Adapts renderer provider settings IPC to the Main-owned settings.json provider service.
// The handler accepts API key writes but never returns plaintext API keys to Renderer.
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import {
  ProviderApiKeyRequestSchema,
  ProviderDeleteApiKeyRequestSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { HostSettingsController } from '@megumi/coding-agent/host-interface';
import { LocalSettingsJsonParseError } from '@megumi/coding-agent/adapters/local';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

// Provider IPC handlers code against host-interface settings provider operations.
export type ProviderHandlersService = HostSettingsController['provider'];

export interface RegisterProviderHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerProviderHandlers(
  service: ProviderHandlersService,
  options: RegisterProviderHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.provider.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema: ProviderListRequestSchema,
      logger: options.logger,
      handle: async () => service.list(),
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.update,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.provider.update,
      requestSchema: ProviderUpdateRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        return service.update(request.payload);
      },
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.setApiKey,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.provider.setApiKey,
      requestSchema: ProviderApiKeyRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        return service.setApiKey(request.payload);
      },
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.deleteApiKey,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.provider.deleteApiKey,
      requestSchema: ProviderDeleteApiKeyRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        return service.deleteApiKey(request.payload);
      },
      mapError: mapProviderIpcError,
    }),
  );
}

function mapProviderIpcError(error: unknown): RuntimeIpcError {
  if (error instanceof LocalSettingsJsonParseError) {
    return {
      code: 'config_invalid',
      message: `Megumi settings are invalid. Fix ${error.settingsPath} and try again.`,
      severity: 'error',
      retryable: false,
      source: 'config',
      details: {
        settingsPath: error.settingsPath,
      },
    };
  }

  return {
    code: 'ipc_handler_failed',
    message: 'Provider settings request failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
