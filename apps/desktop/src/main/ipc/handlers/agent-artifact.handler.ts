import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type { JsonObject } from '@megumi/shared/json';
import type {
  AgentArtifactGetData,
  AgentArtifactGetPayload,
  AgentArtifactListByRunPayload,
  AgentArtifactListBySessionPayload,
  AgentArtifactListData,
  AgentArtifactReferenceData,
  AgentArtifactReferencePayload,
  AgentArtifactStatusUpdateData,
  AgentArtifactStatusUpdatePayload,
  AgentArtifactVersionCreateData,
  AgentArtifactVersionCreatePayload,
  AgentArtifactVersionGetData,
  AgentArtifactVersionGetPayload,
} from '@megumi/shared/ipc-schemas';
import {
  AgentArtifactGetRequestSchema,
  AgentArtifactListByRunRequestSchema,
  AgentArtifactListBySessionRequestSchema,
  AgentArtifactReferenceRequestSchema,
  AgentArtifactStatusUpdateRequestSchema,
  AgentArtifactVersionCreateRequestSchema,
  AgentArtifactVersionGetRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { AgentArtifactService } from '../../services/agent-artifact.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type AgentArtifactHandlersService = Pick<
  AgentArtifactService,
  'listByRun' | 'listBySession' | 'get' | 'getVersion' | 'createVersion' | 'updateStatus' | 'reference'
>;

export interface RegisterAgentArtifactHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentArtifactHandlers(
  service: AgentArtifactHandlersService,
  options: RegisterAgentArtifactHandlersOptions = {},
): void {
  ipcMain.handle(IPC_CHANNELS.agent.artifacts.listByRun, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.listByRun,
    requestSchema: AgentArtifactListByRunRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactListByRunPayload, typeof IPC_CHANNELS.agent.artifacts.listByRun>): AgentArtifactListData => ({
      artifacts: service.listByRun(request.payload.runId),
    }),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.listBySession, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.listBySession,
    requestSchema: AgentArtifactListBySessionRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactListBySessionPayload, typeof IPC_CHANNELS.agent.artifacts.listBySession>): AgentArtifactListData => ({
      artifacts: service.listBySession(request.payload.sessionId),
    }),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.get, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.get,
    requestSchema: AgentArtifactGetRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactGetPayload, typeof IPC_CHANNELS.agent.artifacts.get>): AgentArtifactGetData =>
      service.get(request.payload.artifactId),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.versionGet, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.versionGet,
    requestSchema: AgentArtifactVersionGetRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactVersionGetPayload, typeof IPC_CHANNELS.agent.artifacts.versionGet>): AgentArtifactVersionGetData => ({
      version: service.getVersion(request.payload.artifactVersionId),
    }),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.versionCreate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.versionCreate,
    requestSchema: AgentArtifactVersionCreateRequestSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<AgentArtifactVersionCreatePayload, typeof IPC_CHANNELS.agent.artifacts.versionCreate>,
    ): Promise<AgentArtifactVersionCreateData> => ({
      version: await service.createVersion({
        ...request.payload,
        metadata: toJsonObject(request.payload.metadata),
      }),
    }),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.statusUpdate, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.statusUpdate,
    requestSchema: AgentArtifactStatusUpdateRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactStatusUpdatePayload, typeof IPC_CHANNELS.agent.artifacts.statusUpdate>): AgentArtifactStatusUpdateData => ({
      artifact: service.updateStatus(request.payload),
    }),
    mapError: mapAgentArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.agent.artifacts.reference, createRuntimeIpcHandler({
    channel: IPC_CHANNELS.agent.artifacts.reference,
    requestSchema: AgentArtifactReferenceRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<AgentArtifactReferencePayload, typeof IPC_CHANNELS.agent.artifacts.reference>): AgentArtifactReferenceData => ({
      sourceRef: service.reference({
        ...request.payload,
        metadata: toJsonObject(request.payload.metadata),
      }),
    }),
    mapError: mapAgentArtifactIpcError,
  }));
}

function toJsonObject(value: Record<string, unknown> | undefined): JsonObject | undefined {
  return value as JsonObject | undefined;
}

function mapAgentArtifactIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent artifact service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
