import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
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
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';
import type { InputSendRequest } from '@megumi/coding-agent/input';
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
import { forwardRuntimeEvents } from '.././runtime-event-forwarder';

export interface SessionHandlersServices {
  host: CodingAgentHostInterface;
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
        session: services.host.session.create(request.payload).session,
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
        sessions: services.host.session.list().sessions,
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
        messages: services.host.session.listMessages(request.payload.sessionId).messages,
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
      ): SessionTimelineListData => services.host.session.listTimeline(request.payload),
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
        const result = await services.host.input.send(toHostInputSendRequest(
          request.requestId,
          request.payload,
          context,
        ));
        void forwardRuntimeEvents(event.sender, result.events, { logger: options.logger });
        return {
          requestId: result.requestId,
          session: result.session,
          userMessageId: result.userMessageId,
          runId: result.runId,
        };
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
        cancelled: services.host.input.cancel(request.payload),
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
        const result = services.host.session.createDraft({
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
        const result = services.host.session.cancelDraft({
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

function toHostInputSendRequest(
  requestId: string,
  payload: SessionMessageSendPayload,
  runtimeContext: Parameters<CodingAgentHostInterface['input']['send']>[0]['runtimeContext'],
): InputSendRequest {
  const message = payload.message ?? payload.messages?.at(-1);
  if (!message) {
    throw new Error('Session message send requires a user message.');
  }

  return {
    requestId,
    sessionId: payload.sessionId,
    providerId: payload.providerId,
    modelId: payload.modelId,
    text: message.content,
    clientMessageId: message.id,
    createdAt: payload.createdAt ?? message.createdAt,
    workspaceId: payload.context?.workspaceId,
    workspaceLabel: payload.context?.workspaceLabel,
    workspacePath: payload.context?.workspacePath,
    sessionTitle: payload.context?.sessionTitle,
    permissionMode: payload.context?.permissionMode,
    permissionSource: payload.context?.permissionSource,
    preprocessing: payload.context?.preprocessing,
    branchDraft: payload.branchDraft,
    runtimeContext,
  };
}
