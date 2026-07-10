import type {
  ArtifactListByRunPayload,
  ArtifactListBySessionPayload,
  ArtifactReferencePayload,
  ArtifactStatusUpdatePayload,
  ArtifactVersionCreatePayload,
  ArtifactVersionGetPayload,
} from '../schemas';
import {
  ArtifactGetRequestSchema,
  ArtifactListByRunRequestSchema,
  ArtifactListBySessionRequestSchema,
  ArtifactReferenceRequestSchema,
  ArtifactStatusUpdateRequestSchema,
  ArtifactVersionCreateRequestSchema,
  ArtifactVersionGetRequestSchema,
} from '../schemas';
import type {
  ArtifactHost,
  ArtifactCreateVersionPayload,
  ArtifactGetData,
  ArtifactListData,
  ArtifactReferenceData,
  ArtifactReferencePayload as HostArtifactReferencePayload,
  ArtifactStatusUpdateData,
  ArtifactVersionCreateData,
  ArtifactVersionGetData,
} from '@megumi/product/host-interface';
import {
  ArtifactGetDataSchema,
  ArtifactListDataSchema,
  ArtifactReferenceDataSchema,
  ArtifactStatusUpdateDataSchema,
  ArtifactVersionCreateDataSchema,
  ArtifactVersionGetDataSchema,
} from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError, RuntimeIpcRequest } from '../contracts';

export type ArtifactHandlersService = ArtifactHost;

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
    responseSchema: ArtifactListDataSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactListByRunPayload, typeof IPC_CHANNELS.artifacts.listByRun>): ArtifactListData =>
      service.listByRun(request.payload.runId),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.listBySession, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.listBySession,
    requestSchema: ArtifactListBySessionRequestSchema,
    responseSchema: ArtifactListDataSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactListBySessionPayload, typeof IPC_CHANNELS.artifacts.listBySession>): ArtifactListData =>
      service.listBySession(request.payload.sessionId),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.get,
    requestSchema: ArtifactGetRequestSchema,
    responseSchema: ArtifactGetDataSchema,
    logger: options.logger,
    handle: (request): ArtifactGetData =>
      service.get(request.payload.artifactId),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.versionGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.versionGet,
    requestSchema: ArtifactVersionGetRequestSchema,
    responseSchema: ArtifactVersionGetDataSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactVersionGetPayload, typeof IPC_CHANNELS.artifacts.versionGet>): ArtifactVersionGetData =>
      service.getVersion(request.payload.artifactVersionId),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.versionCreate, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.versionCreate,
    requestSchema: ArtifactVersionCreateRequestSchema,
    responseSchema: ArtifactVersionCreateDataSchema,
    logger: options.logger,
    handle: async (
      request: RuntimeIpcRequest<ArtifactVersionCreatePayload, typeof IPC_CHANNELS.artifacts.versionCreate>,
    ): Promise<ArtifactVersionCreateData> => service.createVersion(request.payload as ArtifactCreateVersionPayload),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.statusUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.statusUpdate,
    requestSchema: ArtifactStatusUpdateRequestSchema,
    responseSchema: ArtifactStatusUpdateDataSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactStatusUpdatePayload, typeof IPC_CHANNELS.artifacts.statusUpdate>): ArtifactStatusUpdateData =>
      service.updateStatus(request.payload),
    mapError: mapArtifactIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.artifacts.reference, createIpcRequestHandler({
    channel: IPC_CHANNELS.artifacts.reference,
    requestSchema: ArtifactReferenceRequestSchema,
    responseSchema: ArtifactReferenceDataSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<ArtifactReferencePayload, typeof IPC_CHANNELS.artifacts.reference>): ArtifactReferenceData =>
      service.reference(request.payload as HostArtifactReferencePayload),
    mapError: mapArtifactIpcError,
  }));
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
