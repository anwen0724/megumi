/* Exposes global configuration and credential status for settings editors. */
import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { builtinProviders } from '@megumi/ai/providers/all';
import { defaultProviderAuthContext } from '@megumi/ai/auth/context';
import type { ApplicationOperations } from '@megumi/application/contracts';
import { SettingsSnapshotSchema, SettingsEditRequestSchema, SettingsEditResultSchema, CredentialTargetSchema, CredentialValueSchema, UpdateCredentialRequestSchema, CredentialUpdateResultSchema } from '@megumi/application/settings/settings-contracts';
import type { DesktopRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { createRuntimeIpcRequestSchema } from '../contracts';
import { normalizeRuntimeIpcError } from '../errors';
import { IPC_CHANNELS } from '../channels';

export interface SettingsHandlersService {
  host: Pick<ApplicationOperations, 'settings'>;
}
export interface RegisterSettingsHandlersOptions {
  logger?: DesktopRuntimeLogger;
  ipcMain?: DesktopIpcMain;
  notifyChanged?: () => void;
}

/** Registers four file-backed operations; successful saves precede notifications. */
export function registerSettingsHandlers(service: SettingsHandlersService, options: RegisterSettingsHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const settings = service.host.settings;
  const mapError = (error: unknown) => normalizeRuntimeIpcError(error, 'Settings operation failed.');
  ipcMain.handle(IPC_CHANNELS.settings.read, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.read,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.read, z.object({}).strict()),
    responseSchema: SettingsSnapshotSchema,
    logger: options.logger, mapError,
    handle: () => {
      const read = settings.readSettings();
      if (read.status === 'rejected') throw read.error;
      return read.settings;
    },
  }));
  ipcMain.handle(IPC_CHANNELS.settings.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.settings.update,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.settings.update, SettingsEditRequestSchema),
    responseSchema: SettingsEditResultSchema,
    logger: options.logger, mapError,
    handle: (request) => {
      const result = settings.updateSettings(request.payload);
      if (result.status === 'rejected') throw result.error;
      if (result.status === 'updated') {
        try {
          if (options.notifyChanged) options.notifyChanged();
          else for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.settings.changed, { scope: 'global' });
        } catch {
          options.logger?.warn('settings_notification_failed');
        }
      }
      return result;
    },
  }));
  ipcMain.handle(IPC_CHANNELS.credentials.read, createIpcRequestHandler({
    channel: IPC_CHANNELS.credentials.read,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.credentials.read, z.object({ target: CredentialTargetSchema }).strict()),
    responseSchema: CredentialValueSchema,
    logger: options.logger, mapError,
    handle: async ({ payload: { target } }) => {
      const read = settings.readSettings();
      if (read.status === 'rejected') throw read.error;
      const config = read.settings.config;
      const apiKeyEnv = target.kind === 'provider' ? config.models.providers[target.providerId]?.apiKeyEnv
        : target.kind === 'voiceTts' ? config.voice.tts.apiKeyEnv
        : target.kind === 'webSearch' ? config.webSearch.apiKeyEnv : undefined;
      const searchEnvironment = { brave: 'BRAVE_SEARCH_API_KEY', tavily: 'TAVILY_API_KEY', exa: 'EXA_API_KEY' };
      const defaultEnvNames = target.kind === 'voiceTts' ? ['MINIMAX_API_KEY']
        : target.kind === 'webSearch' && config.webSearch.provider && config.webSearch.provider !== 'custom'
          ? [searchEnvironment[config.webSearch.provider]]
          : target.kind === 'discoverySource' ? [target.sourceId === 'zhihu' ? 'ZHIHU_ACCESS_SECRET' : 'TWITTERAPI_IO_API_KEY'] : [];
      const credential = settings.readCredential({ target, apiKeyEnv, defaultEnvNames });
      if (credential.status === 'rejected') throw credential.error;
      if (credential.status === 'found') return { status: 'found' as const, value: credential.value, source: credential.source };
      if (target.kind === 'provider' && !apiKeyEnv) {
        const provider = builtinProviders().find((item) => item.id === target.providerId);
        const resolved = await provider?.auth.apiKey?.resolve({ ctx: defaultProviderAuthContext(), signal: new AbortController().signal });
        if (resolved?.auth.apiKey) return { status: 'found' as const, value: resolved.auth.apiKey, source: 'environment' as const };
      }
      return { status: 'missing' as const };
    },
  }));
  ipcMain.handle(IPC_CHANNELS.credentials.update, createIpcRequestHandler({
    channel: IPC_CHANNELS.credentials.update,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.credentials.update, UpdateCredentialRequestSchema),
    responseSchema: CredentialUpdateResultSchema,
    logger: options.logger, mapError,
    handle: ({ payload }) => {
      const result = settings.updateCredential(payload);
      if (result.status === 'rejected') throw result.error;
      return result;
    },
  }));
}
