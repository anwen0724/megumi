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
  VoiceProfileImportRequestSchema,
  VoiceProfileRemoveRequestSchema,
  VoiceProfileRenameRequestSchema,
  VoiceProfileSelectRequestSchema,
  VoiceProfilePreviewRequestSchema,
  VoiceProfilesListRequestSchema,
  VoiceSessionEndRequestSchema,
  VoiceSessionInterruptRequestSchema,
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
  ipcMain.handle(IPC_CHANNELS.voice.profilesList, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profilesList,
    requestSchema: VoiceProfilesListRequestSchema,
    responseSchema: host.VoiceProfilesListResultSchema,
    logger: options.logger,
    handle: () => voice.listProfiles(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.profileImport, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profileImport,
    requestSchema: VoiceProfileImportRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.importProfile(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.profileRename, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profileRename,
    requestSchema: VoiceProfileRenameRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.renameProfile(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.profileRemove, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profileRemove,
    requestSchema: VoiceProfileRemoveRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.removeProfile(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.profileSelect, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profileSelect,
    requestSchema: VoiceProfileSelectRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: (request) => voice.selectProfile(request.payload),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.profilePreview, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.profilePreview,
    requestSchema: VoiceProfilePreviewRequestSchema,
    responseSchema: host.VoiceProfilePreviewResultSchema,
    logger: options.logger,
    handle: (request) => voice.previewProfile(request.payload),
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
  ipcMain.handle(IPC_CHANNELS.voice.sessionInterrupt, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionInterrupt,
    requestSchema: VoiceSessionInterruptRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.interrupt(),
  }));
  ipcMain.handle(IPC_CHANNELS.voice.sessionEnd, createIpcRequestHandler({
    channel: IPC_CHANNELS.voice.sessionEnd,
    requestSchema: VoiceSessionEndRequestSchema,
    responseSchema: host.VoiceHostMutationResultSchema,
    logger: options.logger,
    handle: () => voice.endSession(),
  }));
}
