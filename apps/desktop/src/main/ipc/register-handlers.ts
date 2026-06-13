import { ipcMain } from 'electron';
import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
import {
  registerSettingsHandlers,
  type SettingsHandlersService,
} from './handlers/settings.handler';
import { registerSessionHandlers, type SessionHandlersService } from './handlers/session.handler';
import { registerRunHandlers, type RunHandlersService } from './handlers/run.handler';
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
import type { RecoveryService } from '../services/runtime/recovery.service';
import type { RuntimeLogger } from '../services/runtime/runtime-logger.service';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  settingsService?: SettingsHandlersService;
  sessionRunService?: SessionHandlersService & RunHandlersService;
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
  registerWindowHandlers();
  registerProviderHandlers(undefined, { logger: options.logger });

  if (options.settingsService) {
    registerSettingsHandlers({
      ipcMain,
      settingsService: options.settingsService,
      logger: options.logger,
    });
  }

  if (options.sessionRunService) {
    registerSessionHandlers(options.sessionRunService, { logger: options.logger });
    registerRunHandlers(options.sessionRunService, { logger: options.logger });
  }

  if (options.runContextService) {
    registerRunContextHandlers(options.runContextService, { logger: options.logger });
  }

  if (options.planService) {
    registerPlanHandlers(options.planService, { logger: options.logger });
  }

  if (options.toolService) {
    registerToolHandlers(options.toolService, { logger: options.logger });
  }

  if (options.recoveryService) {
    registerRecoveryHandlers(options.recoveryService, { logger: options.logger });
  }

  if (options.artifactService) {
    registerArtifactHandlers(options.artifactService, { logger: options.logger });
  }

  if (options.memoryService) {
    registerMemoryHandlers({
      ipcMain,
      memoryService: options.memoryService,
      logger: options.logger,
    });
  }

  if (options.projectService) {
    registerProjectHandlers(options.projectService, { logger: options.logger });
  }

  if (options.workspaceFilesService) {
    registerWorkspaceFilesHandlers(options.workspaceFilesService, { logger: options.logger });
  }
}

