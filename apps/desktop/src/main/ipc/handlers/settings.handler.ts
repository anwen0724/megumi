/*
 * Desktop IPC handlers for settings and provider configuration.
 */
import {
  EmptyUiResultSchema,
  ProviderListUiResultSchema,
  SettingsCompleteSetupUiResultSchema,
  SettingsGetUiResultSchema,
  SettingsUpdateUiResultSchema,
  VoiceTtsKeyUiResultSchema,
  type ProductHostInterface,
} from '@megumi/product/host';
import type { ProductRuntimeLogger } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
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
  SettingsCompleteSetupRequestSchema,
  SettingsUpdateRequestSchema,
  VoiceTtsApiKeyRequestSchema,
  VoiceTtsDeleteApiKeyRequestSchema,
} from '../schemas';

export interface SettingsHandlersService {
  host: Pick<ProductHostInterface, 'settings'>;
}

export interface RegisterSettingsHandlersOptions {
  logger?: ProductRuntimeLogger;
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
    responseSchema: SettingsGetUiResultSchema,
    logger: options.logger,
    handle: () => service.host.settings.get({}),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.update,
    requestSchema: SettingsUpdateRequestSchema,
    responseSchema: SettingsUpdateUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.update(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.completeSetup, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.completeSetup,
    requestSchema: SettingsCompleteSetupRequestSchema,
    responseSchema: SettingsCompleteSetupUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.completeSetup(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerList, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerList,
    requestSchema: ProviderListRequestSchema,
    responseSchema: ProviderListUiResultSchema,
    logger: options.logger,
    handle: () => service.host.settings.listProviders({}),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerUpdate,
    requestSchema: ProviderUpdateRequestSchema,
    responseSchema: EmptyUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.updateProvider(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerDelete, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerDelete,
    requestSchema: ProviderDeleteRequestSchema,
    responseSchema: EmptyUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.deleteProvider(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerSetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerSetApiKey,
    requestSchema: ProviderApiKeyRequestSchema,
    responseSchema: EmptyUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.setProviderApiKey(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.providerDeleteApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerDeleteApiKey,
    requestSchema: ProviderDeleteApiKeyRequestSchema,
    responseSchema: EmptyUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.deleteProviderApiKey(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.voiceTtsSetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.voiceTtsSetApiKey,
    requestSchema: VoiceTtsApiKeyRequestSchema,
    responseSchema: VoiceTtsKeyUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.setVoiceTtsApiKey(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.voiceTtsDeleteApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.voiceTtsDeleteApiKey,
    requestSchema: VoiceTtsDeleteApiKeyRequestSchema,
    responseSchema: VoiceTtsKeyUiResultSchema,
    logger: options.logger,
    handle: () => service.host.settings.deleteVoiceTtsApiKey(),
    mapError: mapSettingsIpcError,
  }));
}

function mapSettingsIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Settings service failed.',
  };
}
