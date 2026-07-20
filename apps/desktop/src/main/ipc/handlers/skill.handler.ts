/*
 * Desktop IPC handlers for Skill UI operations.
 */
import {
  DisableSkillUiResponseSchema,
  DeleteSkillUiResponseSchema,
  EnableSkillUiResponseSchema,
  GetSkillDetailUiResponseSchema,
  ListSkillsUiResponseSchema,
  type ProductHostInterface,
} from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  SkillDisableRequestSchema,
  SkillDeleteRequestSchema,
  SkillEnableRequestSchema,
  SkillGetRequestSchema,
  SkillListRequestSchema,
} from '../schemas';

export interface SkillHandlersService {
  host: Pick<ProductHostInterface, 'skill'>;
}

export interface RegisterSkillHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerSkillHandlers(
  service: SkillHandlersService,
  options: RegisterSkillHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.skill.list, createIpcRequestHandler({
    channel: IPC_CHANNELS.skill.list,
    requestSchema: SkillListRequestSchema,
    responseSchema: ListSkillsUiResponseSchema,
    logger: options.logger,
    handle: (request) => service.host.skill.listSkills(request.payload),
    mapError: mapSkillIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.skill.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.skill.get,
    requestSchema: SkillGetRequestSchema,
    responseSchema: GetSkillDetailUiResponseSchema,
    logger: options.logger,
    handle: (request) => service.host.skill.getSkillDetail(request.payload),
    mapError: mapSkillIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.skill.enable, createIpcRequestHandler({
    channel: IPC_CHANNELS.skill.enable,
    requestSchema: SkillEnableRequestSchema,
    responseSchema: EnableSkillUiResponseSchema,
    logger: options.logger,
    handle: (request) => service.host.skill.enableSkill(request.payload),
    mapError: mapSkillIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.skill.disable, createIpcRequestHandler({
    channel: IPC_CHANNELS.skill.disable,
    requestSchema: SkillDisableRequestSchema,
    responseSchema: DisableSkillUiResponseSchema,
    logger: options.logger,
    handle: (request) => service.host.skill.disableSkill(request.payload),
    mapError: mapSkillIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.skill.delete, createIpcRequestHandler({
    channel: IPC_CHANNELS.skill.delete,
    requestSchema: SkillDeleteRequestSchema,
    responseSchema: DeleteSkillUiResponseSchema,
    logger: options.logger,
    handle: (request) => service.host.skill.deleteSkill(request.payload),
    mapError: mapSkillIpcError,
  }));
}

function mapSkillIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Skill service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
