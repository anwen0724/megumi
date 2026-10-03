/* Exposes the runtime model catalog for global settings or an existing workspace. */
import { z } from 'zod';
import { ModelCatalogResultSchema } from '@megumi/application/contracts';
import type { ApplicationOperations } from '@megumi/application/contracts';
import type { DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { createRuntimeIpcRequestSchema } from '../contracts';
import { IPC_CHANNELS } from '../channels';

export function registerModelsHandlers(
  host: Pick<ApplicationOperations, 'models'>,
  ipcMain: DesktopIpcMain,
): void {
  ipcMain.handle(
    IPC_CHANNELS.models.getCatalog,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.models.getCatalog,
      requestSchema: createRuntimeIpcRequestSchema(
        IPC_CHANNELS.models.getCatalog,
        z.object({ workspaceId: z.string().min(1).optional() }).strict(),
      ),
      responseSchema: ModelCatalogResultSchema,
      handle: ({ payload }) => host.models.readModelCatalog(payload),
    }),
  );
}
