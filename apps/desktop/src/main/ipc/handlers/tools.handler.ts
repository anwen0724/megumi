/* Exposes tool identities and labels for permission editing. */
import { z } from 'zod';
import type { ApplicationOperations } from '@megumi/application/contracts';
import type { DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { createRuntimeIpcRequestSchema } from '../contracts';
import { IPC_CHANNELS } from '../channels';

export function registerToolsHandlers(
  host: Pick<ApplicationOperations, 'tools'>,
  ipcMain: DesktopIpcMain,
): void {
  ipcMain.handle(
    IPC_CHANNELS.tools.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.tools.list,
      requestSchema: createRuntimeIpcRequestSchema(IPC_CHANNELS.tools.list, z.object({}).strict()),
      responseSchema: z.object({
        tools: z.array(
          z.object({
            identity: z.object({
              sourceId: z.string(),
              namespace: z.string(),
              sourceToolName: z.string(),
            }),
            name: z.string(),
            displayName: z.string(),
          }),
        ),
      }),
      handle: () => ({
        tools: host.tools.listAvailableTools({ includeDisabled: true }).tools.map((tool) => ({
          identity: tool.identity,
          name: tool.registeredToolName,
          displayName: tool.definition.name,
        })),
      }),
    }),
  );
}
