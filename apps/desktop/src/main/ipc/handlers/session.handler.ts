import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type { Session, SessionMessage } from '@megumi/shared/session';
import type {
  SessionCreateData,
  SessionCreatePayload,
  SessionBranchDraftCancelData,
  SessionBranchDraftCancelPayload,
  SessionBranchDraftCreateData,
  SessionBranchDraftCreatePayload,
  SessionListData,
  SessionMessageListData,
  SessionMessageListPayload,
  SessionMessageCancelData,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import {
  SessionBranchDraftCancelRequestSchema,
  SessionBranchDraftCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionListRequestSchema,
  SessionMessageListRequestSchema,
  SessionMessageCancelRequestSchema,
  SessionMessageSendRequestSchema,
  SessionTimelineListRequestSchema,
} from '@megumi/shared/ipc';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';

export interface SessionHandlersSessionService {
  createSession(payload: SessionCreatePayload): Session;
  listSessions(): Session[];
  listMessagesBySession(sessionId: string): SessionMessage[];
  listTimelineMessagesBySession(payload: SessionTimelineListPayload): SessionTimelineListData;
}

export interface SessionHandlersProductRuntime {
  sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean;
}

export interface SessionHandlersBranchService {
  createBranchDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): { branchDraft: SessionBranchDraftCreateData['branchDraft']; events: Iterable<RuntimeEvent> };
  cancelBranchDraft(input: {
    requestId: string;
    sessionId: string;
    branchMarkerId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    cancelled: boolean;
    reason?: SessionBranchDraftCancelData['reason'];
    events: Iterable<RuntimeEvent>;
  };
}

export interface SessionHandlersServices {
  sessionService: SessionHandlersSessionService;
  productRuntime: SessionHandlersProductRuntime;
  sessionBranchService: SessionHandlersBranchService;
}

export interface RegisterSessionHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerSessionHandlers(
  services: SessionHandlersServices,
  options: RegisterSessionHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.session.create,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.create,
      requestSchema: SessionCreateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionCreatePayload, typeof IPC_CHANNELS.session.create>,
      ): SessionCreateData => ({
        session: services.sessionService.createSession(request.payload),
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.list,
      requestSchema: SessionListRequestSchema,
      logger: options.logger,
      handle: (): SessionListData => ({
        sessions: services.sessionService.listSessions(),
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.message.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.message.list,
      requestSchema: SessionMessageListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionMessageListPayload, typeof IPC_CHANNELS.session.message.list>,
      ): SessionMessageListData => ({
        messages: services.sessionService.listMessagesBySession(request.payload.sessionId) as SessionMessageListData['messages'],
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.timeline.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.timeline.list,
      requestSchema: SessionTimelineListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.session.timeline.list>,
      ): SessionTimelineListData => services.sessionService.listTimelineMessagesBySession(request.payload),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.message.send,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.message.send,
      requestSchema: SessionMessageSendRequestSchema,
      logger: options.logger,
      handle: async (
        request: RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.session.message.send>,
        event,
        context,
      ): Promise<SessionMessageSendData> => {
        const result = await services.productRuntime.sendSessionMessage({
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
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.message.cancel,
      requestSchema: SessionMessageCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.message.cancel>,
      ): SessionMessageCancelData => ({
        cancelled: services.productRuntime.cancelSessionMessage(request.payload),
      }),
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.branchDraft.create,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.branchDraft.create,
      requestSchema: SessionBranchDraftCreateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.session.branchDraft.create>,
        event,
        context,
      ): SessionBranchDraftCreateData => {
        const result = services.sessionBranchService.createBranchDraft({
          requestId: request.requestId,
          ...request.payload,
          runtimeContext: context,
        });
        void forwardRuntimeEvents(event.sender, asyncIterableFrom(result.events), { logger: options.logger });
        return { branchDraft: result.branchDraft };
      },
      mapError: mapSessionIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.session.branchDraft.cancel,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.session.branchDraft.cancel,
      requestSchema: SessionBranchDraftCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.session.branchDraft.cancel>,
        event,
        context,
      ): SessionBranchDraftCancelData => {
        const result = services.sessionBranchService.cancelBranchDraft({
          requestId: request.requestId,
          ...request.payload,
          runtimeContext: context,
        });
        void forwardRuntimeEvents(event.sender, asyncIterableFrom(result.events), { logger: options.logger });
        return {
          cancelled: result.cancelled,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      },
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

async function* asyncIterableFrom<T>(items: Iterable<T>): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}
