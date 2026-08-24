/*
 * Desktop IPC handlers for Session operations and command suggestions.
 */
import {
  CancelBranchDraftPayloadSchema,
  CancelUserInputPayloadSchema,
  GetInputSuggestionsResultSchema,
  CreateBranchDraftPayloadSchema,
  CreateSessionResultSchema,
  ReadSessionResultSchema,
  ReadCommittedRunResultSchema,
  GetContextUsageResultSchema,
  ListUserMessagesByExecutionIdsResultSchema,
  ListSessionsResultSchema,
  SendUserInputPayloadSchema,
  InputCapabilitiesResultSchema,
  SelectImagesResultSchema,
  SelectDocumentsResultSchema,
  ReadAttachmentImageResultSchema,
  AttachmentFileStatusResultSchema,
  type ProductHostInterface,
} from '@megumi/product/host';

import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';

import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError, RuntimeIpcRequest } from '../contracts';
import {
  InputSuggestionsRequestSchema,
  CommittedRunReadRequestSchema,
  SessionBranchDraftCancelRequestSchema,
  SessionBranchDraftCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionReadRequestSchema,
  SessionListRequestSchema,
  SessionMessageCancelRequestSchema,
  SessionContextUsageGetRequestSchema,
  SessionMessageListRequestSchema,
  SessionMessageSendRequestSchema,
  InputCapabilitiesGetRequestSchema,
  ImageInputSelectRequestSchema,
  DocumentInputSelectRequestSchema,
  ImageInputClipboardReadRequestSchema,
  AttachmentImageReadRequestSchema,
  AttachmentFileStatusRequestSchema,
  type InputSuggestionsPayload,
  type CommittedRunReadPayload,
  type SessionBranchDraftCancelPayload,
  type SessionBranchDraftCreatePayload,
  type SessionCreatePayload,
  type SessionReadPayload,
  type SessionMessageCancelPayload,
  type SessionContextUsageGetPayload,
  type SessionMessageListPayload,
  type SessionMessageSendPayload,
  type AttachmentImageReadPayload,
  type AttachmentFileStatusPayload,
  type DocumentInputSelectPayload,
} from '../schemas';
import type { SessionMessagePresentationEvent } from '../session-message-presentation';

export interface SessionHandlersService {
  host: Pick<ProductHostInterface, 'session'>;
}

export interface RegisterSessionHandlersOptions {
  logger?: ProductRuntimeLogger;
  ipcMain?: DesktopIpcMain;
  publishMessageEvent?(event: SessionMessagePresentationEvent): void;
}

export function registerSessionHandlers(
  service: SessionHandlersService,
  options: RegisterSessionHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.session.inputSuggestions, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.inputSuggestions,
    requestSchema: InputSuggestionsRequestSchema,
    responseSchema: GetInputSuggestionsResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<InputSuggestionsPayload, typeof IPC_CHANNELS.session.inputSuggestions>) =>
      service.host.session.getInputSuggestions(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionCreate,
    requestSchema: SessionCreateRequestSchema,
    responseSchema: CreateSessionResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionCreatePayload, typeof IPC_CHANNELS.session.sessionCreate>) =>
      service.host.session.createSession(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionList, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionList,
    requestSchema: SessionListRequestSchema,
    responseSchema: ListSessionsResultSchema,
    logger: options.logger,
    handle: () => service.host.session.listSessions({}),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionMessageList, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionMessageList,
    requestSchema: SessionMessageListRequestSchema,
    responseSchema: ListUserMessagesByExecutionIdsResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionMessageListPayload, typeof IPC_CHANNELS.session.sessionMessageList>) =>
      service.host.session.listUserMessagesByExecutionIds(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionRead,
    requestSchema: SessionReadRequestSchema,
    responseSchema: ReadSessionResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionReadPayload, typeof IPC_CHANNELS.session.sessionRead>) =>
      service.host.session.readSession(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.committedRunRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.committedRunRead,
    requestSchema: CommittedRunReadRequestSchema,
    responseSchema: ReadCommittedRunResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<CommittedRunReadPayload, typeof IPC_CHANNELS.session.committedRunRead>) =>
      service.host.session.readCommittedRun(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionContextUsageGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionContextUsageGet,
    requestSchema: SessionContextUsageGetRequestSchema,
    responseSchema: GetContextUsageResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.session.sessionContextUsageGet>) =>
      service.host.session.getContextUsage(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.inputCapabilitiesGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.inputCapabilitiesGet,
    requestSchema: InputCapabilitiesGetRequestSchema,
    responseSchema: InputCapabilitiesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.getInputCapabilities(),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.imageInputSelect, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.imageInputSelect,
    requestSchema: ImageInputSelectRequestSchema,
    responseSchema: SelectImagesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.selectImages(),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.documentInputSelect, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.documentInputSelect,
    requestSchema: DocumentInputSelectRequestSchema,
    responseSchema: SelectDocumentsResultSchema,
    logger: options.logger,
    handle: (_request: RuntimeIpcRequest<DocumentInputSelectPayload, typeof IPC_CHANNELS.session.documentInputSelect>) =>
      service.host.session.selectDocuments(),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.imageInputClipboardRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.imageInputClipboardRead,
    requestSchema: ImageInputClipboardReadRequestSchema,
    responseSchema: SelectImagesResultSchema,
    logger: options.logger,
    handle: () => service.host.session.readClipboardImage(),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.attachmentImageRead, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.attachmentImageRead,
    requestSchema: AttachmentImageReadRequestSchema,
    responseSchema: ReadAttachmentImageResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AttachmentImageReadPayload, typeof IPC_CHANNELS.session.attachmentImageRead>) =>
      service.host.session.readAttachmentImage(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.attachmentFileStatus, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.attachmentFileStatus,
    requestSchema: AttachmentFileStatusRequestSchema,
    responseSchema: AttachmentFileStatusResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AttachmentFileStatusPayload, typeof IPC_CHANNELS.session.attachmentFileStatus>) =>
      service.host.session.getAttachmentFileStatus(request.payload),
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionMessageSend, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionMessageSend,
    requestSchema: SessionMessageSendRequestSchema,
    responseSchema: SendUserInputPayloadSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.session.sessionMessageSend>,
      event,
    ) => {
      const presentation = createMessagePresentation(request.payload);
      if (presentation && request.payload.sessionId) {
        options.publishMessageEvent?.({
          phase: 'pending',
          ...presentation,
          sessionId: request.payload.sessionId,
        });
      }
      const result = await service.host.session.sendUserInput({
        requestId: request.requestId,
        ...request.payload,
      });
      if (presentation && result.payload.type === 'agent_run') {
        options.publishMessageEvent?.({
          phase: 'accepted',
          ...presentation,
          sessionId: result.payload.session.id,
          messageId: result.payload.userMessage.messageId,
          executionId: result.payload.run.executionId,
        });
      }
      return result.payload;
    },
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.sessionMessageCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.sessionMessageCancel,
    requestSchema: SessionMessageCancelRequestSchema,
    responseSchema: CancelUserInputPayloadSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<SessionMessageCancelPayload, typeof IPC_CHANNELS.session.sessionMessageCancel>,
      event,
    ) => {
      const result = await service.host.session.cancelUserInput(request.payload);
      return result.payload;
    },
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.branchDraftCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.branchDraftCreate,
    requestSchema: SessionBranchDraftCreateRequestSchema,
    responseSchema: CreateBranchDraftPayloadSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCreatePayload, typeof IPC_CHANNELS.session.branchDraftCreate>, event) => {
      const result = service.host.session.createBranchDraft({
        requestId: request.requestId,
        ...request.payload,
      });
      return result.payload;
    },
    mapError: mapSessionIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.session.branchDraftCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.session.branchDraftCancel,
    requestSchema: SessionBranchDraftCancelRequestSchema,
    responseSchema: CancelBranchDraftPayloadSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<SessionBranchDraftCancelPayload, typeof IPC_CHANNELS.session.branchDraftCancel>, event) => {
      const result = service.host.session.cancelBranchDraft({
        requestId: request.requestId,
        ...request.payload,
      });
      return result.payload;
    },
    mapError: mapSessionIpcError,
  }));

}

function createMessagePresentation(payload: SessionMessageSendPayload):
  Omit<Extract<SessionMessagePresentationEvent, { phase: 'pending' }>, 'phase' | 'sessionId'>
  | undefined {
  if (!payload.clientMessageId || !payload.createdAt) return undefined;
  return {
    projectId: payload.projectId,
    clientMessageId: payload.clientMessageId,
    text: payload.text,
    ...(payload.attachments?.length ? {
      attachments: payload.attachments.map((attachment) => ({
        draftAttachmentId: attachment.draftAttachmentId,
        type: attachment.type,
        name: attachment.name ?? '',
        ...(attachment.declaredMimeType ? { declaredMimeType: attachment.declaredMimeType } : {}),
      })),
    } : {}),
    createdAt: payload.createdAt,
  };
}

function mapSessionIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Session service failed.',
  };
}

