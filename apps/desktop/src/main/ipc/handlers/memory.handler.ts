import {
  MemoryAccessLogsListRequestSchema,
  MemoryArchiveRequestSchema,
  MemoryCandidateAcceptRequestSchema,
  MemoryCandidateArchiveRequestSchema,
  MemoryCandidateEditAndAcceptRequestSchema,
  MemoryCandidateListRequestSchema,
  MemoryCandidateRejectRequestSchema,
  MemoryDeleteRequestSchema,
  MemoryDisableRequestSchema,
  MemoryEnableRequestSchema,
  MemoryGetRequestSchema,
  MemoryListRequestSchema,
  MemoryRecallPreviewRequestSchema,
  MemorySourceRefsListRequestSchema,
  MemoryUpdateRequestSchema,
} from '../schemas';
import { createIpcRequestHandler } from '../create-request-handler';
import type { MemoryService } from '@megumi/coding-agent/memory';
import type { RuntimeLogger } from '@megumi/product/logging';
import type { DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../errors';

export type MemoryHandlersService = Pick<
  MemoryService,
  | 'listCandidates'
  | 'acceptCandidate'
  | 'rejectCandidate'
  | 'archiveCandidate'
  | 'listMemories'
  | 'getMemory'
  | 'updateMemory'
  | 'archiveMemory'
  | 'deleteMemory'
  | 'disableMemory'
  | 'enableMemory'
  | 'listSourceRefs'
  | 'listAccessLogs'
  | 'recallPreview'
>;

export interface RegisterMemoryHandlersOptions {
  ipcMain: DesktopIpcMain;
  memoryService: MemoryHandlersService;
  logger?: RuntimeLogger;
}

export function registerMemoryHandlers(options: RegisterMemoryHandlersOptions): void {
  const { ipcMain, memoryService, logger } = options;

  ipcMain.handle(IPC_CHANNELS.memory.candidateList, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.candidateList,
    requestSchema: MemoryCandidateListRequestSchema,
    logger,
    handle: (request) => ({ candidates: memoryService.listCandidates(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateAccept, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.candidateAccept,
    requestSchema: MemoryCandidateAcceptRequestSchema,
    logger,
    handle: (request) => memoryService.acceptCandidate(request.payload),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateReject, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.candidateReject,
    requestSchema: MemoryCandidateRejectRequestSchema,
    logger,
    handle: (request) => ({ candidate: memoryService.rejectCandidate(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateArchive, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.candidateArchive,
    requestSchema: MemoryCandidateArchiveRequestSchema,
    logger,
    handle: (request) => ({ candidate: memoryService.archiveCandidate(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateEditAndAccept, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.candidateEditAndAccept,
    requestSchema: MemoryCandidateEditAndAcceptRequestSchema,
    logger,
    handle: (request) => memoryService.acceptCandidate(request.payload),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryList, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryList,
    requestSchema: MemoryListRequestSchema,
    logger,
    handle: (request) => ({ memories: memoryService.listMemories(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryGet,
    requestSchema: MemoryGetRequestSchema,
    logger,
    handle: (request) => memoryService.getMemory(request.payload.memoryId),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryUpdate,
    requestSchema: MemoryUpdateRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.updateMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryArchive, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryArchive,
    requestSchema: MemoryArchiveRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.archiveMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryDelete, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryDelete,
    requestSchema: MemoryDeleteRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.deleteMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryDisable, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryDisable,
    requestSchema: MemoryDisableRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.disableMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryEnable, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.memoryEnable,
    requestSchema: MemoryEnableRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.enableMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.sourceRefsList, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.sourceRefsList,
    requestSchema: MemorySourceRefsListRequestSchema,
    logger,
    handle: (request) => ({ sourceRefs: memoryService.listSourceRefs(request.payload.memoryId) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.accessLogsList, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.accessLogsList,
    requestSchema: MemoryAccessLogsListRequestSchema,
    logger,
    handle: (request) => ({ accessLogs: memoryService.listAccessLogs(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.recallPreview, createIpcRequestHandler({
    channel: IPC_CHANNELS.memory.recallPreview,
    requestSchema: MemoryRecallPreviewRequestSchema,
    logger,
    handle: (request) => memoryService.recallPreview(request.payload),
    mapError: mapMemoryIpcError,
  }));


































}

function mapMemoryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Memory service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
