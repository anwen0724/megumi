import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import {
  AgentMemoryAccessLogsListRequestSchema,
  AgentMemoryArchiveRequestSchema,
  AgentMemoryCandidateAcceptRequestSchema,
  AgentMemoryCandidateArchiveRequestSchema,
  AgentMemoryCandidateEditAndAcceptRequestSchema,
  AgentMemoryCandidateListRequestSchema,
  AgentMemoryCandidateRejectRequestSchema,
  AgentMemoryDeleteRequestSchema,
  AgentMemoryDisableRequestSchema,
  AgentMemoryEnableRequestSchema,
  AgentMemoryGetRequestSchema,
  AgentMemoryListRequestSchema,
  AgentMemoryRecallPreviewRequestSchema,
  AgentMemorySettingsGetRequestSchema,
  AgentMemorySettingsUpdateRequestSchema,
  AgentMemorySourceRefsListRequestSchema,
  AgentMemoryUpdateRequestSchema,
} from '@megumi/shared/ipc-schemas';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import type { AgentMemoryService } from '../../services/agent-memory.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';

export type AgentMemoryHandlersService = Pick<
  AgentMemoryService,
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

export interface RegisterAgentMemoryHandlersOptions {
  ipcMain: Pick<IpcMain, 'handle'>;
  agentMemoryService: AgentMemoryHandlersService;
  logger?: RuntimeLogger;
}

export function registerAgentMemoryHandlers(options: RegisterAgentMemoryHandlersOptions): void {
  const { ipcMain, agentMemoryService, logger } = options;

  ipcMain.handle(IPC_CHANNELS.agent.memory.settingsGet, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.settingsGet,
    requestSchema: AgentMemorySettingsGetRequestSchema,
    logger,
    handle: (request) => ({ settings: agentMemoryService.getSettings(request.payload.workspaceId) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.settingsUpdate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.settingsUpdate,
    requestSchema: AgentMemorySettingsUpdateRequestSchema,
    logger,
    handle: (request) => ({ settings: agentMemoryService.updateSettings(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.candidateList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.candidateList,
    requestSchema: AgentMemoryCandidateListRequestSchema,
    logger,
    handle: (request) => ({ candidates: agentMemoryService.listCandidates(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.candidateAccept, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.candidateAccept,
    requestSchema: AgentMemoryCandidateAcceptRequestSchema,
    logger,
    handle: (request) => agentMemoryService.acceptCandidate(request.payload),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.candidateReject, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.candidateReject,
    requestSchema: AgentMemoryCandidateRejectRequestSchema,
    logger,
    handle: (request) => ({ candidate: agentMemoryService.rejectCandidate(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.candidateArchive, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.candidateArchive,
    requestSchema: AgentMemoryCandidateArchiveRequestSchema,
    logger,
    handle: (request) => ({ candidate: agentMemoryService.archiveCandidate(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.candidateEditAndAccept, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.candidateEditAndAccept,
    requestSchema: AgentMemoryCandidateEditAndAcceptRequestSchema,
    logger,
    handle: (request) => agentMemoryService.acceptCandidate({
      candidateId: request.payload.candidateId,
      reviewedAt: request.payload.reviewedAt,
      reviewedBy: request.payload.reviewedBy,
    }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryList,
    requestSchema: AgentMemoryListRequestSchema,
    logger,
    handle: (request) => ({ memories: agentMemoryService.listMemories(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryGet, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryGet,
    requestSchema: AgentMemoryGetRequestSchema,
    logger,
    handle: (request) => agentMemoryService.getMemory(request.payload.memoryId),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryUpdate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryUpdate,
    requestSchema: AgentMemoryUpdateRequestSchema,
    logger,
    handle: (request) => ({ memory: agentMemoryService.updateMemory(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryArchive, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryArchive,
    requestSchema: AgentMemoryArchiveRequestSchema,
    logger,
    handle: (request) => ({ memory: agentMemoryService.archiveMemory(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryDelete, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryDelete,
    requestSchema: AgentMemoryDeleteRequestSchema,
    logger,
    handle: (request) => ({ memory: agentMemoryService.deleteMemory(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryDisable, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryDisable,
    requestSchema: AgentMemoryDisableRequestSchema,
    logger,
    handle: (request) => ({ memory: agentMemoryService.disableMemory(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.memoryEnable, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.memoryEnable,
    requestSchema: AgentMemoryEnableRequestSchema,
    logger,
    handle: (request) => ({ memory: agentMemoryService.enableMemory(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.sourceRefsList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.sourceRefsList,
    requestSchema: AgentMemorySourceRefsListRequestSchema,
    logger,
    handle: (request) => ({ sourceRefs: agentMemoryService.listSourceRefs(request.payload.memoryId) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.accessLogsList, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.accessLogsList,
    requestSchema: AgentMemoryAccessLogsListRequestSchema,
    logger,
    handle: (request) => ({ accessLogs: agentMemoryService.listAccessLogs(request.payload) }),
    mapError: mapAgentMemoryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.memory.recallPreview, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.memory.recallPreview,
    requestSchema: AgentMemoryRecallPreviewRequestSchema,
    logger,
    handle: (request) => agentMemoryService.recallPreview(request.payload),
    mapError: mapAgentMemoryIpcError,
  }));
}

function mapAgentMemoryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent memory service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
