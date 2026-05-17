import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
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
  MemorySettingsGetRequestSchema,
  MemorySettingsUpdateRequestSchema,
  MemorySourceRefsListRequestSchema,
  MemoryUpdateRequestSchema,
} from '@megumi/shared/ipc-schemas';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import type { MemoryService } from '../../services/memory.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';

export type MemoryHandlersService = Pick<
  MemoryService,
  | 'getSettings'
  | 'updateSettings'
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
  ipcMain: Pick<IpcMain, 'handle'>;
  memoryService: MemoryHandlersService;
  logger?: RuntimeLogger;
}

export function registerMemoryHandlers(options: RegisterMemoryHandlersOptions): void {
  const { ipcMain, memoryService, logger } = options;

  ipcMain.handle(IPC_CHANNELS.memory.settingsGet, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.settingsGet,
    requestSchema: MemorySettingsGetRequestSchema,
    logger,
    handle: (request) => ({ settings: memoryService.getSettings(request.payload.workspaceId) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.settingsUpdate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.settingsUpdate,
    requestSchema: MemorySettingsUpdateRequestSchema,
    logger,
    handle: (request) => ({ settings: memoryService.updateSettings(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.candidateList,
    requestSchema: MemoryCandidateListRequestSchema,
    logger,
    handle: (request) => ({ candidates: memoryService.listCandidates(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateAccept, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.candidateAccept,
    requestSchema: MemoryCandidateAcceptRequestSchema,
    logger,
    handle: (request) => memoryService.acceptCandidate(request.payload),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateReject, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.candidateReject,
    requestSchema: MemoryCandidateRejectRequestSchema,
    logger,
    handle: (request) => ({ candidate: memoryService.rejectCandidate(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateArchive, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.candidateArchive,
    requestSchema: MemoryCandidateArchiveRequestSchema,
    logger,
    handle: (request) => ({ candidate: memoryService.archiveCandidate(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.candidateEditAndAccept, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.candidateEditAndAccept,
    requestSchema: MemoryCandidateEditAndAcceptRequestSchema,
    logger,
    handle: (request) => memoryService.acceptCandidate(request.payload),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryList,
    requestSchema: MemoryListRequestSchema,
    logger,
    handle: (request) => ({ memories: memoryService.listMemories(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryGet, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryGet,
    requestSchema: MemoryGetRequestSchema,
    logger,
    handle: (request) => memoryService.getMemory(request.payload.memoryId),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryUpdate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryUpdate,
    requestSchema: MemoryUpdateRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.updateMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryArchive, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryArchive,
    requestSchema: MemoryArchiveRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.archiveMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryDelete, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryDelete,
    requestSchema: MemoryDeleteRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.deleteMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryDisable, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryDisable,
    requestSchema: MemoryDisableRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.disableMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.memoryEnable, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.memoryEnable,
    requestSchema: MemoryEnableRequestSchema,
    logger,
    handle: (request) => ({ memory: memoryService.enableMemory(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.sourceRefsList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.sourceRefsList,
    requestSchema: MemorySourceRefsListRequestSchema,
    logger,
    handle: (request) => ({ sourceRefs: memoryService.listSourceRefs(request.payload.memoryId) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.accessLogsList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.memory.accessLogsList,
    requestSchema: MemoryAccessLogsListRequestSchema,
    logger,
    handle: (request) => ({ accessLogs: memoryService.listAccessLogs(request.payload) }),
    mapError: mapMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.memory.recallPreview, createRuntimeIpcHandler({
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
