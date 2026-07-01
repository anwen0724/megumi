// Registers command query IPC used by renderer composer suggestion UI.
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  CommandSuggestionsData,
  CommandSuggestionsPayload,
} from '@megumi/shared/ipc';
import {
  CommandSuggestionsRequestSchema,
} from '@megumi/shared/ipc';
import type { CommandService } from '@megumi/coding-agent/commands';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export type CommandHandlersService = Pick<CommandService, 'getCommandSuggestions'>;

export interface RegisterCommandHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerCommandHandlers(
  service: CommandHandlersService,
  options: RegisterCommandHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.command.suggestions,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.command.suggestions,
      requestSchema: CommandSuggestionsRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<CommandSuggestionsPayload, typeof IPC_CHANNELS.command.suggestions>,
      ): CommandSuggestionsData => ({
        suggestions: service.getCommandSuggestions({
          draft_input: request.payload.draft_input,
        }),
      }),
      mapError: mapCommandIpcError,
    }),
  );
}

function mapCommandIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Command service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
