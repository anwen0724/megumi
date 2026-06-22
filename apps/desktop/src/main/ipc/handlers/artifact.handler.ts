import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type { JsonObject } from '@megumi/shared/primitives';
import type {
  ArtifactGetData,
  ArtifactGetPayload,
  ArtifactListByRunPayload,
  ArtifactListBySessionPayload,
  ArtifactListData,
  ArtifactReferenceData,
  ArtifactReferencePayload,
  ArtifactStatusUpdateData,
  ArtifactStatusUpdatePayload,
  ArtifactVersionCreateData,
  ArtifactVersionCreatePayload,
  ArtifactVersionGetData,
  ArtifactVersionGetPayload,
} from '@megumi/shared/ipc';
import {
  ArtifactGetRequestSchema,
  ArtifactListByRunRequestSchema,
  ArtifactListBySessionRequestSchema,
  ArtifactReferenceRequestSchema,
  ArtifactStatusUpdateRequestSchema,
  ArtifactVersionCreateRequestSchema,
  ArtifactVersionGetRequestSchema,
} from '@megumi/shared/ipc';
import type { ArtifactService } from '@megumi/coding-agent/artifacts';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../host/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export type ArtifactHandlersService = Pick<
  ArtifactService,
  'listByRun' | 'listBySession' | 'get' | 'getVersion' | 'createVersion' | 'updateStatus' | 'reference'
>;

export interface RegisterArtifactHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerArtifactHandlers(
  service: ArtifactHandlersService,
  options: RegisterArtifactHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.artifacts.listByRun, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.listByRun,
    requestSchema: ArtifactListByRunRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactListByRunPayload, typeof IPC_CHANNELS.artifacts.listByRun>): ArtifactListData => ({
      artifacts: service.listByRun(request.payload.runId),
    }),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.listBySession, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.listBySession,
    requestSchema: ArtifactListBySessionRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactListBySessionPayload, typeof IPC_CHANNELS.artifacts.listBySession>): ArtifactListData => ({
      artifacts: service.listBySession(request.payload.sessionId),
    }),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.get,
    requestSchema: ArtifactGetRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactGetPayload, typeof IPC_CHANNELS.artifacts.get>): ArtifactGetData =>
      service.get(request.payload.artifactId),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.versionGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.versionGet,
    requestSchema: ArtifactVersionGetRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactVersionGetPayload, typeof IPC_CHANNELS.artifacts.versionGet>): ArtifactVersionGetData => ({
      version: service.getVersion(request.payload.artifactVersionId),
    }),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.versionCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.versionCreate,
    requestSchema: ArtifactVersionCreateRequestSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<ArtifactVersionCreatePayload, typeof IPC_CHANNELS.artifacts.versionCreate>,
    ): Promise<ArtifactVersionCreateData> => ({
      version: await service.createVersion({
        ...request.payload,
        metadata: toJsonObject(request.payload.metadata),
      }),
    }),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.statusUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.statusUpdate,
    requestSchema: ArtifactStatusUpdateRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactStatusUpdatePayload, typeof IPC_CHANNELS.artifacts.statusUpdate>): ArtifactStatusUpdateData => ({
      artifact: service.updateStatus(request.payload),
    }),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.reference, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.reference,
    requestSchema: ArtifactReferenceRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactReferencePayload, typeof IPC_CHANNELS.artifacts.reference>): ArtifactReferenceData => ({
      sourceRef: service.reference({
        ...request.payload,
        metadata: toJsonObject(request.payload.metadata),
      }),
    }),
    mapError: mapArtifactIpcError,
  }));














}

function toJsonObject(value: Record<string, unknown> | undefined): JsonObject | undefined {
  return value as JsonObject | undefined;
}

function mapArtifactIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Artifact service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}


