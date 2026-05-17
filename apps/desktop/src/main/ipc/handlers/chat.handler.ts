import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type {
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc-schemas';
import {
  ChatCancelRequestSchema,
  ChatStartRequestSchema,
} from '@megumi/shared/ipc-schemas';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';
import type { RuntimeLogger } from '../../services/runtime-logger.service';

export interface ChatHandlersService {
  sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean;
}

export interface RegisterChatHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerChatHandlers(
  service: ChatHandlersService,
  options: RegisterChatHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.chat.start,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.chat.start,
      requestSchema: ChatStartRequestSchema,
      logger: options.logger,
      handle: async (request, event, context) => {
        const result = await service.sendSessionMessage({
          requestId: request.requestId,
          payload: request.payload,
          runtimeContext: context,
        });

        void forwardRuntimeEvents(event.sender, result.events, { logger: options.logger });

        return result.data;
      },
      mapError: mapChatIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chat.cancel,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.chat.cancel,
      requestSchema: ChatCancelRequestSchema,
      logger: options.logger,
      handle: async (request) => ({
        cancelled: service.cancelSessionMessage(request.payload),
      }),
      mapError: mapChatIpcError,
    }),
  );
}

function mapChatIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Chat service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
