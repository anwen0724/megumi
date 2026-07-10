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
import { registerMemoryHandlers, type MemoryHandlersService } from './handlers/memory.handler';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../shell/electron-ipc-main-host';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
  workspace?: WorkspaceHandlersService;
  chat?: ChatHandlersService;
  skill?: SkillHandlersService;
  settings?: SettingsHandlersService;
  approval?: ApprovalHandlersService;
  artifact?: ArtifactHandlersService;
  memory?: MemoryHandlersService;
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

  if (options.memory) {
    registerMemoryHandlers({ memoryService: options.memory, logger: options.logger, ipcMain });
  }
}
