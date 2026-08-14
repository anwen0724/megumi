/*
 * Exposes Product VoiceHost operations through validated Desktop IPC envelopes.
 * The handler remains a transport controller and never calls Voice internals directly.
 */
import * as host from '@megumi/product/host';
import type { ProductRuntimeLogger } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import { createIpcRequestHandler } from '../create-request-handler';
import {
  VoiceModelCapabilityRequestSchema,
  VoiceModelStatusRequestSchema,
  VoiceModelsCancelRequestSchema,
  VoiceModelsCheckUpdatesRequestSchema,
  VoiceModelsPrepareRequestSchema,
  VoiceSessionEndRequestSchema,
  VoiceSessionManualFinishRequestSchema,
  VoiceSessionManualStartRequestSchema,
  VoiceSessionMuteRequestSchema,
  VoiceSessionStartRequestSchema,
  VoiceSnapshotRequestSchema,
} from '../schemas';

export interface VoiceHandlersService {
  readonly host: Pick<host.ProductHostInterface, 'voice'>;
}

export function registerVoiceHandlers(
  service: VoiceHandlersService,
  options: { readonly logger?: ProductRuntimeLogger; readonly ipcMain?: DesktopIpcMain } = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const voice = service.host.voice;

  ipcMain.handle(IPC_CHANNELS.voice.snapshot, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.snapshot,
    requestSchema: VoiceSnapshotRequestSchema,
    responseSchema: host.VoiceSnapshotSchema,
    logger: options.logger,
    handle: () => voice.getSnapshot(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.modelStatus, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.modelStatus,
    requestSchema: VoiceModelStatusRequestSchema,
    responseSchema: host.VoiceModelStatusResultSchema,
    logger: options.logger,
    handle: () => voice.getModelStatus(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.modelCapability, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.modelCapability,
    requestSchema: VoiceModelCapabilityRequestSchema,
    responseSchema: host.VoiceModelCapabilityStatusSchema,
    logger: options.logger,
    handle: (request) => voice.getModelCapabilityStatus(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.modelsCheckUpdates, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.modelsCheckUpdates,
    requestSchema: VoiceModelsCheckUpdatesRequestSchema,
    responseSchema: host.VoiceModelUpdateResultSchema,
    logger: options.logger,
    handle: () => voice.checkModelUpdates(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.modelsPrepare, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.modelsPrepare,
    requestSchema: VoiceModelsPrepareRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.prepareModels(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.modelsCancel, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.modelsCancel,
    requestSchema: VoiceModelsCancelRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.cancelModelPreparation(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionStart, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionStart,
    requestSchema: VoiceSessionStartRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.startSession(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionManualStart, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionManualStart,
    requestSchema: VoiceSessionManualStartRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.startManualUtterance(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionManualFinish, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionManualFinish,
    requestSchema: VoiceSessionManualFinishRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.finishManualUtterance(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionMute, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionMute,
    requestSchema: VoiceSessionMuteRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.setMuted(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionEnd, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionEnd,
    requestSchema: VoiceSessionEndRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.endSession(),
  }));
}
