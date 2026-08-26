/*
 * Desktop IPC handlers for settings and provider configuration.
 */
import {
  CredentialValueUiResultSchema,
  EmptyUiResultSchema,
  ProviderListUiResultSchema,
  SettingsCompleteSetupUiResultSchema,
  SettingsGetUiResultSchema,
  SettingsUpdateUiResultSchema,
  VoiceTtsKeyUiResultSchema,
  DiscoverySourceCredentialStatusUiResultSchema,
  type ProductHostInterface,
} from '@megumi/product-host/host';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  ProviderApiKeyRequestSchema,
  ProviderGetApiKeyRequestSchema,
  ProviderDeleteRequestSchema,
  ProviderDeleteApiKeyRequestSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
  SettingsGetRequestSchema,
  SettingsCompleteSetupRequestSchema,
  SettingsUpdateRequestSchema,
  VoiceTtsApiKeyRequestSchema,
  VoiceTtsGetApiKeyRequestSchema,
  VoiceTtsDeleteApiKeyRequestSchema,
  DiscoveryCredentialGetRequestSchema,
  DiscoveryCredentialSetRequestSchema,
  DiscoveryCredentialDeleteRequestSchema,
  WebSearchGetApiKeyRequestSchema,
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

  ipcMain.handle(IPC_CHANNELS.settings.providerGetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.providerGetApiKey,
    requestSchema: ProviderGetApiKeyRequestSchema,
    responseSchema: CredentialValueUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.getProviderApiKey(request.payload),
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

  ipcMain.handle(IPC_CHANNELS.settings.webSearchGetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.webSearchGetApiKey,
    requestSchema: WebSearchGetApiKeyRequestSchema,
    responseSchema: CredentialValueUiResultSchema,
    logger: options.logger,
    handle: () => service.host.settings.getWebSearchApiKey(),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.voiceTtsGetApiKey, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.voiceTtsGetApiKey,
    requestSchema: VoiceTtsGetApiKeyRequestSchema,
    responseSchema: CredentialValueUiResultSchema,
    logger: options.logger,
    handle: () => service.host.settings.getVoiceTtsApiKey(),
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

  ipcMain.handle(IPC_CHANNELS.settings.discoveryCredentialGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.discoveryCredentialGet,
    requestSchema: DiscoveryCredentialGetRequestSchema,
    responseSchema: DiscoverySourceCredentialStatusUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.getDiscoverySourceCredential(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.discoveryCredentialSet, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.discoveryCredentialSet,
    requestSchema: DiscoveryCredentialSetRequestSchema,
    responseSchema: DiscoverySourceCredentialStatusUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.setDiscoverySourceCredential(request.payload),
    mapError: mapSettingsIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.settings.discoveryCredentialDelete, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.discoveryCredentialDelete,
    requestSchema: DiscoveryCredentialDeleteRequestSchema,
    responseSchema: DiscoverySourceCredentialStatusUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.settings.deleteDiscoverySourceCredential(request.payload),
    mapError: mapSettingsIpcError,
  }));
}

function mapSettingsIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Settings service failed.',
  };
}
