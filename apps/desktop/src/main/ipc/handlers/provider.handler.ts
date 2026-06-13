// Adapts renderer provider settings IPC to the Main-owned settings.json provider service.
// The handler accepts API key writes but never returns plaintext API keys to Renderer.
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import {
  ProviderApiKeyRequestSchema,
  ProviderDeleteApiKeyRequestSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { ProviderId, ProviderPublicStatus, ProviderSettings } from '@megumi/shared/provider';
import { initializeElectronMegumiHomeSync } from '@megumi/desktop/main/services/project/megumi-home.service';
import { ProviderSettingsService, type ProviderSettingsUpdateInput } from '@megumi/desktop/main/services/provider/provider-settings.service';
import { createAppSettingsService, AppSettingsParseError } from '@megumi/desktop/main/services/settings/app-settings.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';

export interface ProviderHandlersService {
  getProviderSettings(providerId: ProviderId): Promise<ProviderSettings>;
  listProviderStatuses(): Promise<ProviderPublicStatus[]>;
  updateProviderSettings(providerId: ProviderId, input: ProviderSettingsUpdateInput): Promise<unknown>;
  setProviderApiKey(providerId: ProviderId, apiKey: string): Promise<unknown>;
  deleteProviderApiKey(providerId: ProviderId): Promise<unknown>;
}

export interface RegisterProviderHandlersOptions {
  logger?: RuntimeLogger;
}

let defaultProviderService: ProviderHandlersService | null = null;

export function registerProviderHandlers(
  service = getDefaultProviderService(),
  options: RegisterProviderHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.provider.list,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.list,
      requestSchema: ProviderListRequestSchema,
      logger: options.logger,
      handle: async () => ({
        providers: await service.listProviderStatuses(),
      }),
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.update,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.update,
      requestSchema: ProviderUpdateRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        const { providerId, ...input } = request.payload;
        await service.updateProviderSettings(providerId, input);
        return {};
      },
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.setApiKey,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.setApiKey,
      requestSchema: ProviderApiKeyRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        await service.setProviderApiKey(request.payload.providerId, request.payload.apiKey);
        return {};
      },
      mapError: mapProviderIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.provider.deleteApiKey,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.provider.deleteApiKey,
      requestSchema: ProviderDeleteApiKeyRequestSchema,
      logger: options.logger,
      handle: async (request) => {
        await service.deleteProviderApiKey(request.payload.providerId);
        return {};
      },
      mapError: mapProviderIpcError,
    }),
  );
}

function mapProviderIpcError(error: unknown): RuntimeIpcError {
  if (error instanceof AppSettingsParseError) {
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

export function getDefaultProviderService(): ProviderHandlersService {
  if (!defaultProviderService) {
    const homePaths = initializeElectronMegumiHomeSync();
    defaultProviderService = new ProviderSettingsService({
      settings: createAppSettingsService({
        settingsPath: homePaths.settingsPath,
      }),
    });
  }

  return defaultProviderService;
}
