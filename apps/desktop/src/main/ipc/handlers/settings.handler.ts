/*
 * Desktop IPC handlers for settings and provider configuration.
 */
import type { ProductHostInterface } from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  ProviderApiKeyRequestSchema,
  ProviderDeleteRequestSchema,
  ProviderDeleteApiKeyRequestSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
  SettingsGetRequestSchema,
  SettingsUpdateRequestSchema,
} from '../schemas';

export interface SettingsHandlersService {
  host: Pick<ProductHostInterface, 'settings'>;
}

export interface RegisterSettingsHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerSettingsHandlers(
  service: SettingsHandlersService,
  options: RegisterSettingsHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.settings.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.get,
    requestSchema: SettingsGetRequestSchema,
    logger: options.logger,
    handle: () => service.host.settings.get({}),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.update,
    requestSchema: SettingsUpdateRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.update(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerList, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerList,
    requestSchema: ProviderListRequestSchema,
    logger: options.logger,
    handle: () => service.host.settings.listProviders({}),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerUpdate,
    requestSchema: ProviderUpdateRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.updateProvider(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerDelete, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerDelete,
    requestSchema: ProviderDeleteRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.deleteProvider(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerSetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerSetApiKey,
    requestSchema: ProviderApiKeyRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.setProviderApiKey(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerDeleteApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerDeleteApiKey,
    requestSchema: ProviderDeleteApiKeyRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.deleteProviderApiKey(request.payload),
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
