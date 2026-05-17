import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  SessionCreateData,
  SessionCreatePayload,
  SessionListData,
  SessionMessageCancelData,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc-schemas';
import {
  SessionCreateRequestSchema,
  SessionListRequestSchema,
  SessionMessageCancelRequestSchema,
  SessionMessageSendRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { SessionRunService } from '../../services/session-run.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';

export type SessionHandlersService = Pick<
  SessionRunService,
  'createSession' | 'listSessions' | 'sendSessionMessage' | 'cancelSessionMessage'
>;

export interface RegisterSessionHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerSessionHandlers(
  service: SessionHandlersService,
  options: RegisterSessionHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.session.create,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.session.create,
      requestSchema: SessionCreateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionCreatePayload, typeof IPC_CHANNELS.session.create>,
      ): SessionCreateData => ({
        session: service.createSession(request.payload),
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.list,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.session.list,
      requestSchema: SessionListRequestSchema,
      logger: options.logger,
      handle: (): SessionListData => ({
        sessions: service.listSessions(),
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.message.send,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.session.message.send,
      requestSchema: SessionMessageSendRequestSchema,
      logger: options.logger,
      handle: async (
        request: RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.session.message.send>,
        event,
        context,
      ): Promise<SessionMessageSendData> => {
        const result = await service.sendSessionMessage({
          requestId: request.requestId,
          payload: request.payload,
          runtimeContext: context,
        });
        void forwardRuntimeEvents(event.sender, result.events, { logger: options.logger });
        return result.data;
      },
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.message.cancel,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.session.message.cancel,
      requestSchema: SessionMessageCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.message.cancel>,
      ): SessionMessageCancelData => ({
        cancelled: service.cancelSessionMessage(request.payload),
      }),
      mapError: mapSessionIpcError,
    }),
  );
}

function mapSessionIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Session service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
