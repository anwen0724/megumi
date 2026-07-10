/*
 * Desktop IPC handlers for chat, session, command suggestions, and run hydration.
 */
import {
  ChatSendUserInputUiPayloadSchema,
  type ProductHostInterface,
} from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { forwardRuntimeEvents } from '../event-forwarders';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError, RuntimeIpcRequest } from '../contracts';
import {
  CommandSuggestionsRequestSchema,
  RunEventsListRequestSchema,
  RunListBySessionRequestSchema,
  SessionBranchDraftCancelRequestSchema,
  SessionBranchDraftCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionListRequestSchema,
  SessionMessageCancelRequestSchema,
  SessionContextUsageGetRequestSchema,
  SessionMessageListRequestSchema,
  SessionMessageSendRequestSchema,
  SessionTimelineListRequestSchema,
  type CommandSuggestionsPayload,
  type RunEventsListPayload,
  type RunListBySessionPayload,
  type SessionBranchDraftCancelPayload,
  type SessionBranchDraftCreatePayload,
  type SessionCreatePayload,
  type SessionMessageCancelPayload,
  type SessionContextUsageGetPayload,
  type SessionMessageListPayload,
  type SessionMessageSendPayload,
  type SessionTimelineListPayload,
} from '../schemas';

export interface ChatHandlersService {
  host: Pick<ProductHostInterface, 'chat'>;
}

export interface RegisterChatHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerChatHandlers(
  service: ChatHandlersService,
  options: RegisterChatHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.chat.commandSuggestions, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.commandSuggestions,
    requestSchema: CommandSuggestionsRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<CommandSuggestionsPayload, typeof IPC_CHANNELS.chat.commandSuggestions>) =>
      service.host.chat.getCommandSuggestions(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionCreate,
    requestSchema: SessionCreateRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionCreatePayload, typeof IPC_CHANNELS.chat.sessionCreate>) =>
      service.host.chat.createSession(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionList,
    requestSchema: SessionListRequestSchema,
    logger: options.logger,
    handle: () => service.host.chat.listSessions({}),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageList,
    requestSchema: SessionMessageListRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionMessageListPayload, typeof IPC_CHANNELS.chat.sessionMessageList>) =>
      service.host.chat.listMessages(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionTimelineList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionTimelineList,
    requestSchema: SessionTimelineListRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.chat.sessionTimelineList>) =>
      service.host.chat.listTimeline(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionContextUsageGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionContextUsageGet,
    requestSchema: SessionContextUsageGetRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.chat.sessionContextUsageGet>) =>
      service.host.chat.getContextUsage(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageSend, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageSend,
    requestSchema: SessionMessageSendRequestSchema,
    responseSchema: ChatSendUserInputUiPayloadSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.chat.sessionMessageSend>,
      event,
      context,
    ) => {
      const result = await service.host.chat.sendUserInput({
        requestId: request.requestId,
        ...request.payload,
        runtimeContext: context,
      });
      scheduleEvents(event.sender, result.events, options.logger);
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageCancel,
    requestSchema: SessionMessageCancelRequestSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.chat.sessionMessageCancel>,
      event,
    ) => {
      const result = await service.host.chat.cancelUserInput(request.payload);
      scheduleEvents(event.sender, result.events, options.logger);
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.branchDraftCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.branchDraftCreate,
    requestSchema: SessionBranchDraftCreateRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.chat.branchDraftCreate>, event, context) => {
      const result = service.host.chat.createBranchDraft({
        requestId: request.requestId,
        ...request.payload,
        runtimeContext: context,
      });
      scheduleEvents(event.sender, result.events, options.logger);
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.branchDraftCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.branchDraftCancel,
    requestSchema: SessionBranchDraftCancelRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.chat.branchDraftCancel>, event, context) => {
      const result = service.host.chat.cancelBranchDraft({
        requestId: request.requestId,
        ...request.payload,
        runtimeContext: context,
      });
      scheduleEvents(event.sender, result.events, options.logger);
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.runListBySession, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.runListBySession,
    requestSchema: RunListBySessionRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<RunListBySessionPayload, typeof IPC_CHANNELS.chat.runListBySession>) =>
      service.host.chat.listRuns(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.runEventsList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.runEventsList,
    requestSchema: RunEventsListRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<RunEventsListPayload, typeof IPC_CHANNELS.chat.runEventsList>) =>
      service.host.chat.listRunEvents(request.payload),
    mapError: mapChatIpcError,
  }));
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

function scheduleEvents(
  sender: { send(channel: string, event: import('@megumi/product/host-interface').RuntimeEvent): void },
  events: AsyncIterable<import('@megumi/product/host-interface').RuntimeEvent> | undefined,
  logger?: RuntimeLogger,
): void {
  if (!events) return;
  setTimeout(() => {
    void forwardRuntimeEvents(sender, events, { logger });
  }, 0);
}
