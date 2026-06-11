import { ipcMain } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import {
  ProviderApiKeyRequestSchema,
  ProviderDeleteApiKeyRequestSchema,
  ProviderListRequestSchema,
  ProviderUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { ProviderId, ProviderPublicStatus, ProviderSettings } from '@megumi/shared/provider';
import { createDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ProviderSettingsRepository } from '@megumi/db/repos/provider-settings.repo';
import {
  MegumiHomeConfigParseError,
  MegumiHomeConfigService,
} from '@megumi/desktop/main/services/megumi-home-config.service';
import { initializeElectronMegumiHomeSync } from '@megumi/desktop/main/services/megumi-home.service';
import { ProviderSettingsService, type ProviderSettingsUpdateInput } from '@megumi/desktop/main/services/provider-settings.service';
import { createElectronSecretStoreService } from '@megumi/desktop/main/services/secret-store.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import type { RuntimeLogger } from '../../services/runtime-logger.service';

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
  if (error instanceof MegumiHomeConfigParseError) {
    return {
      code: 'config_invalid',
      message: `Megumi config is invalid. Fix ${error.configPath} and try again.`,
      severity: 'error',
      retryable: false,
      source: 'config',
      details: {
        configPath: error.configPath,
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
    const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
    migrateDatabase(database);

    const configCredentials = {
      async getProviderApiKeyEnv(providerId: ProviderId) {
        return new MegumiHomeConfigService({ configPath: homePaths.configPath }).getProviderApiKeyEnv(providerId);
      },
      async getPlaintextProviderApiKey(providerId: ProviderId) {
        return new MegumiHomeConfigService({ configPath: homePaths.configPath }).getPlaintextProviderApiKey(providerId);
      },
    };

    defaultProviderService = new ProviderSettingsService({
      repository: new ProviderSettingsRepository(database),
      secretStore: createElectronSecretStoreService(homePaths.homePath),
      configCredentials,
    });
  }

  return defaultProviderService;
}

