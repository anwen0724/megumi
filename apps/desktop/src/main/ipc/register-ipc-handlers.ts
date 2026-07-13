/*
 * Registers Desktop Main IPC channels with host-interface controllers and shell adapters.
 */
import { registerWindowHandlers } from './handlers/window.handler';
import { registerWorkspaceHandlers, type WorkspaceHandlersService } from './handlers/workspace.handler';
import { registerChatHandlers, type ChatHandlersService } from './handlers/chat.handler';
import { registerSkillHandlers, type SkillHandlersService } from './handlers/skill.handler';
import { registerSettingsHandlers, type SettingsHandlersService } from './handlers/settings.handler';
import { registerApprovalHandlers, type ApprovalHandlersService } from './handlers/approval.handler';
import {
  registerArtifactHandlers,
  type ArtifactHandlersService,
} from './handlers/artifact.handler';
import type { RuntimeLogger } from '@megumi/product/logging';
import { registerObservabilityHandlers } from './handlers/observability.handler';
import { electronIpcMain, type DesktopIpcMain } from '../adapters/electron-ipc-main-adapter';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
  workspace?: WorkspaceHandlersService;
  chat?: ChatHandlersService;
  skill?: SkillHandlersService;
  settings?: SettingsHandlersService;
  approval?: ApprovalHandlersService;
  artifact?: ArtifactHandlersService;
  observability?: { host: Pick<import('@megumi/product/host-interface').ProductHostInterface, 'observability'> };
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  registerWindowHandlers({ ipcMain });

  if (options.workspace) {
    registerWorkspaceHandlers(options.workspace, { logger: options.logger, ipcMain });
  }

  if (options.chat) {
    registerChatHandlers(options.chat, { logger: options.logger, ipcMain });
  }

  if (options.skill) {
    registerSkillHandlers(options.skill, { logger: options.logger, ipcMain });
  }

  if (options.settings) {
    registerSettingsHandlers(options.settings, { logger: options.logger, ipcMain });
  }

  if (options.approval) {
    registerApprovalHandlers(options.approval, { logger: options.logger, ipcMain });
  }

  if (options.artifact) {
    registerArtifactHandlers(options.artifact, { logger: options.logger, ipcMain });
  }

  if (options.observability) {
    registerObservabilityHandlers(options.observability, { logger: options.logger, ipcMain });
  }

}
