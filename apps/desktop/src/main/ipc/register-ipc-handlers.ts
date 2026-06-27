// Registers Desktop Main IPC channels with services assembled by composition.
import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers, type ProviderHandlersService } from './handlers/provider.handler';
import {
  registerSettingsHandlers,
  type SettingsHandlersService,
} from './handlers/settings.handler';
import { registerSessionHandlers, type SessionHandlersServices } from './handlers/session.handler';
import { registerRunHandlers, type RunHandlersServices } from './handlers/run.handler';
import {
  registerRunContextHandlers,
  type RunContextHandlersService,
} from './handlers/run-context.handler';
import {
  registerPlanHandlers,
  type PlanHandlersService,
} from './handlers/plan.handler';
import {
  registerToolHandlers,
  type ToolHandlersService,
} from './handlers/tool.handler';
import { registerRecoveryHandlers } from './handlers/recovery.handler';
import {
  registerArtifactHandlers,
  type ArtifactHandlersService,
} from './handlers/artifact.handler';
import {
  registerMemoryHandlers,
  type MemoryHandlersService,
} from './handlers/memory.handler';
import {
  registerProjectHandlers,
  type ProjectHandlersService,
} from './handlers/project.handler';
import {
  registerWorkspaceFilesHandlers,
  type WorkspaceFilesHandlersService,
} from './handlers/workspace-files.handler';
import type { RecoveryService } from '@megumi/coding-agent/run';
import type { RuntimeLogger } from '../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../shell/electron-ipc-main-host';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
  providerService?: ProviderHandlersService;
  settingsService?: SettingsHandlersService;
  sessionHandlers?: SessionHandlersServices;
  runHandlers?: RunHandlersServices;
  runContextService?: RunContextHandlersService;
  planService?: PlanHandlersService;
  toolService?: ToolHandlersService;
  recoveryService?: RecoveryService;
  artifactService?: ArtifactHandlersService;
  memoryService?: MemoryHandlersService;
  projectService?: ProjectHandlersService;
  workspaceFilesService?: WorkspaceFilesHandlersService;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  registerWindowHandlers({ ipcMain });

  if (options.providerService) {
    registerProviderHandlers(options.providerService, { logger: options.logger, ipcMain });
  }

  if (options.settingsService) {
    registerSettingsHandlers({
      ipcMain,
      settingsService: options.settingsService,
      logger: options.logger,
    });
  }

  if (options.sessionHandlers) {
    registerSessionHandlers(options.sessionHandlers, { logger: options.logger, ipcMain });
  }

  if (options.runHandlers) {
    registerRunHandlers(options.runHandlers, { logger: options.logger, ipcMain });
  }

  if (options.runContextService) {
    registerRunContextHandlers(options.runContextService, { logger: options.logger, ipcMain });
  }

  if (options.planService) {
    registerPlanHandlers(options.planService, { logger: options.logger, ipcMain });
  }

  if (options.toolService) {
    registerToolHandlers(options.toolService, { logger: options.logger, ipcMain });
  }

  if (options.recoveryService) {
    registerRecoveryHandlers(options.recoveryService, { logger: options.logger, ipcMain });
  }

  if (options.artifactService) {
    registerArtifactHandlers(options.artifactService, { logger: options.logger, ipcMain });
  }

  if (options.memoryService) {
    registerMemoryHandlers({
      ipcMain,
      memoryService: options.memoryService,
      logger: options.logger,
    });
  }

  if (options.projectService) {
    registerProjectHandlers(options.projectService, { logger: options.logger, ipcMain });
  }

  if (options.workspaceFilesService) {
    registerWorkspaceFilesHandlers(options.workspaceFilesService, { logger: options.logger, ipcMain });
  }
}
