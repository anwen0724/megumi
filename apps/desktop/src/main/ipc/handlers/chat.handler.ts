/*
 * Desktop IPC handlers for chat, session, command suggestions, and run hydration.
 */
import {
  CancelBranchDraftPayloadSchema,
  CancelUserInputPayloadSchema,
  GetInputSuggestionsResultSchema,
  CreateBranchDraftPayloadSchema,
  CreateSessionResultSchema,
  GetSessionHydrationResultSchema,
  GetContextUsageResultSchema,
  ListUserMessagesByRunIdsResultSchema,
  ListRunEventsResultSchema,
  ListRunsResultSchema,
  ListSessionsResultSchema,
  ListSessionTimelineResultSchema,
  SendUserInputPayloadSchema,
  InputCapabilitiesResultSchema,
  SelectImagesResultSchema,
  SelectDocumentsResultSchema,
  ReadAttachmentImageResultSchema,
  AttachmentFileStatusResultSchema,
  type ProductHostInterface,
} from '@megumi/product/host';

import type { ProductRuntimeLogger } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';

import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError, RuntimeIpcRequest } from '../contracts';
import {
  InputSuggestionsRequestSchema,
  RunEventsListRequestSchema,
  RunListBySessionRequestSchema,
  SessionBranchDraftCancelRequestSchema,
  SessionBranchDraftCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionHydrationGetRequestSchema,
  SessionListRequestSchema,
  SessionMessageCancelRequestSchema,
  SessionContextUsageGetRequestSchema,
  SessionMessageListRequestSchema,
  SessionMessageSendRequestSchema,
  SessionTimelineListRequestSchema,
  InputCapabilitiesGetRequestSchema,
  ImageInputSelectRequestSchema,
  DocumentInputSelectRequestSchema,
  ImageInputClipboardReadRequestSchema,
  AttachmentImageReadRequestSchema,
  AttachmentFileStatusRequestSchema,
  type InputSuggestionsPayload,
  type RunEventsListPayload,
  type RunListBySessionPayload,
  type SessionBranchDraftCancelPayload,
  type SessionBranchDraftCreatePayload,
  type SessionCreatePayload,
  type SessionHydrationGetPayload,
  type SessionMessageCancelPayload,
  type SessionContextUsageGetPayload,
  type SessionMessageListPayload,
  type SessionMessageSendPayload,
  type SessionTimelineListPayload,
  type AttachmentImageReadPayload,
  type AttachmentFileStatusPayload,
  type DocumentInputSelectPayload,
} from '../schemas';

export interface ChatHandlersService {
  host: Pick<ProductHostInterface, 'session'>;
}

export interface RegisterChatHandlersOptions {
  logger?: ProductRuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerChatHandlers(
  service: ChatHandlersService,
  options: RegisterChatHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.chat.inputSuggestions, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.inputSuggestions,
    requestSchema: InputSuggestionsRequestSchema,
    responseSchema: GetInputSuggestionsResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<InputSuggestionsPayload, typeof IPC_CHANNELS.chat.inputSuggestions>) =>
      service.host.session.getInputSuggestions(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionCreate,
    requestSchema: SessionCreateRequestSchema,
    responseSchema: CreateSessionResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionCreatePayload, typeof IPC_CHANNELS.chat.sessionCreate>) =>
      service.host.session.createSession(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionList,
    requestSchema: SessionListRequestSchema,
    responseSchema: ListSessionsResultSchema,
    logger: options.logger,
    handle: () => service.host.session.listSessions({}),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageList,
    requestSchema: SessionMessageListRequestSchema,
    responseSchema: ListUserMessagesByRunIdsResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionMessageListPayload, typeof IPC_CHANNELS.chat.sessionMessageList>) =>
      service.host.session.listUserMessagesByRunIds(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionTimelineList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionTimelineList,
    requestSchema: SessionTimelineListRequestSchema,
    responseSchema: ListSessionTimelineResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionTimelineListPayload, typeof IPC_CHANNELS.chat.sessionTimelineList>) =>
      service.host.session.listTimeline(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionHydrationGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionHydrationGet,
    requestSchema: SessionHydrationGetRequestSchema,
    responseSchema: GetSessionHydrationResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionHydrationGetPayload, typeof IPC_CHANNELS.chat.sessionHydrationGet>) =>
      service.host.session.getSessionHydration(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionContextUsageGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionContextUsageGet,
    requestSchema: SessionContextUsageGetRequestSchema,
    responseSchema: GetContextUsageResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.chat.sessionContextUsageGet>) =>
      service.host.session.getContextUsage(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.inputCapabilitiesGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.inputCapabilitiesGet,
    requestSchema: InputCapabilitiesGetRequestSchema,
    responseSchema: InputCapabilitiesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.getInputCapabilities(),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.imageInputSelect, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.imageInputSelect,
    requestSchema: ImageInputSelectRequestSchema,
    responseSchema: SelectImagesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.selectImages(),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.documentInputSelect, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.documentInputSelect,
    requestSchema: DocumentInputSelectRequestSchema,
    responseSchema: SelectDocumentsResultSchema,
    logger: options.logger,
    handle: (_request: RuntimeIpcRequest<DocumentInputSelectPayload, typeof IPC_CHANNELS.chat.documentInputSelect>) =>
      service.host.session.selectDocuments(),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.imageInputClipboardRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.imageInputClipboardRead,
    requestSchema: ImageInputClipboardReadRequestSchema,
    responseSchema: SelectImagesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.readClipboardImage(),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.attachmentImageRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.attachmentImageRead,
    requestSchema: AttachmentImageReadRequestSchema,
    responseSchema: ReadAttachmentImageResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AttachmentImageReadPayload, typeof IPC_CHANNELS.chat.attachmentImageRead>) =>
      service.host.session.readAttachmentImage(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.attachmentFileStatus, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.attachmentFileStatus,
    requestSchema: AttachmentFileStatusRequestSchema,
    responseSchema: AttachmentFileStatusResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AttachmentFileStatusPayload, typeof IPC_CHANNELS.chat.attachmentFileStatus>) =>
      service.host.session.getAttachmentFileStatus(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageSend, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageSend,
    requestSchema: SessionMessageSendRequestSchema,
    responseSchema: SendUserInputPayloadSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.chat.sessionMessageSend>,
      event,
    ) => {
      const result = await service.host.session.sendUserInput({
        requestId: request.requestId,
        ...request.payload,
      });
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.sessionMessageCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.sessionMessageCancel,
    requestSchema: SessionMessageCancelRequestSchema,
    responseSchema: CancelUserInputPayloadSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.chat.sessionMessageCancel>,
      event,
    ) => {
      const result = await service.host.session.cancelUserInput(request.payload);
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.branchDraftCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.branchDraftCreate,
    requestSchema: SessionBranchDraftCreateRequestSchema,
    responseSchema: CreateBranchDraftPayloadSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.chat.branchDraftCreate>, event) => {
      const result = service.host.session.createBranchDraft({
        requestId: request.requestId,
        ...request.payload,
      });
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.branchDraftCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.branchDraftCancel,
    requestSchema: SessionBranchDraftCancelRequestSchema,
    responseSchema: CancelBranchDraftPayloadSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.chat.branchDraftCancel>, event) => {
      const result = service.host.session.cancelBranchDraft({
        requestId: request.requestId,
        ...request.payload,
      });
      return result.payload;
    },
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.runListBySession, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.runListBySession,
    requestSchema: RunListBySessionRequestSchema,
    responseSchema: ListRunsResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<RunListBySessionPayload, typeof IPC_CHANNELS.chat.runListBySession>) =>
      service.host.session.listRuns(request.payload),
    mapError: mapChatIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.chat.runEventsList, createIpcRequestHandler({
    channel: IPC_CHANNELS.chat.runEventsList,
    requestSchema: RunEventsListRequestSchema,
    responseSchema: ListRunEventsResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<RunEventsListPayload, typeof IPC_CHANNELS.chat.runEventsList>) =>
      service.host.session.listRunEvents(request.payload),
    mapError: mapChatIpcError,
  }));
}

function mapChatIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Chat service failed.',
  };
}

