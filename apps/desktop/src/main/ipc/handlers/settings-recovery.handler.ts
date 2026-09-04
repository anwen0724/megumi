/* Exposes fixed-path configuration recovery without granting arbitrary filesystem access. */
import { z } from 'zod';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import { createRuntimeIpcRequestSchema, type RuntimeIpcError } from '../contracts';
import { createIpcRequestHandler } from '../create-request-handler';

/** Desktop supplies the active configuration location and orderly shell operations. */
export interface SettingsRecoveryService {
  readonly settingsPath: string;
  openDirectory(): Promise<void>;
  restart(): Promise<void>;
}

const EmptySchema = z.object({}).strict();

/** Registers recovery even when Product Settings cannot resolve. */
export function registerSettingsRecoveryHandlers(
  service: SettingsRecoveryService,
  options: { ipcMain?: DesktopIpcMain } = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const mapError = (): RuntimeIpcError => ({ code: 'ipc_handler_failed', message: 'Settings recovery operation failed.' });
  ipcMain.handle(IPC_CHANNELS.settingsRecovery.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.settingsRecovery.get,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.settingsRecovery.get, EmptySchema),
    responseSchema: z.object({ settingsPath: z.string().min(1) }).strict(),
    handle: () => ({ settingsPath: service.settingsPath }),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.settingsRecovery.openDirectory, createIpcRequestHandler({
    channel: IPC_CHANNELS.settingsRecovery.openDirectory,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.settingsRecovery.openDirectory, EmptySchema),
    responseSchema: EmptySchema,
    handle: async () => { await service.openDirectory(); return {}; },
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.settingsRecovery.restart, createIpcRequestHandler({
    channel: IPC_CHANNELS.settingsRecovery.restart,
    requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.settingsRecovery.restart, EmptySchema),
    responseSchema: EmptySchema,
    handle: async () => { await service.restart(); return {}; },
    mapError,
  }));
}
