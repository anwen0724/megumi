// Registers Desktop Main IPC channels with services assembled by composition.
import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers, type ProviderHandlersService } from './handlers/provider.handler';
import {
  registerSettingsHandlers,
  type SettingsHandlersService,
} from './handlers/settings.handler';
import { registerSessionHandlers, type SessionHandlersServices } from './handlers/session.handler';
import {
  registerPlanHandlers,
  type PlanHandlersService,
} from './handlers/plan.handler';
import {
  registerToolHandlers,
  type PermissionHandlersService,
} from './handlers/tool.handler';
import {
  registerArtifactHandlers,
  type ArtifactHandlersService,
} from './handlers/artifact.handler';
import {
  registerProjectHandlers,
  type ProjectHandlersService,
} from './handlers/project.handler';
import {
  registerWorkspaceFilesHandlers,
  type WorkspaceFilesHandlersService,
} from './handlers/workspace-files.handler';
import type { RuntimeLogger } from '../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../shell/electron-ipc-main-host';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
  providerService?: ProviderHandlersService;
  settingsService?: SettingsHandlersService;
  sessionHandlers?: SessionHandlersServices;
  planService?: PlanHandlersService;
  permissionsService?: PermissionHandlersService;
  artifactService?: ArtifactHandlersService;
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

  if (options.planService) {
    registerPlanHandlers(options.planService, { logger: options.logger, ipcMain });
  }

  if (options.permissionsService) {
    registerToolHandlers(options.permissionsService, { logger: options.logger, ipcMain });
  }

  if (options.artifactService) {
    registerArtifactHandlers(options.artifactService, { logger: options.logger, ipcMain });
  }

  if (options.projectService) {
    registerProjectHandlers(options.projectService, { logger: options.logger, ipcMain });
  }

  if (options.workspaceFilesService) {
    registerWorkspaceFilesHandlers(options.workspaceFilesService, { logger: options.logger, ipcMain });
  }
}
