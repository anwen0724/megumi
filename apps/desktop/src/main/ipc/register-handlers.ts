import { ipcMain } from 'electron';
import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
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
import type { RecoveryService } from '../services/recovery.service';
import type { RuntimeLogger } from '../services/runtime-logger.service';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  sessionRunService?: SessionHandlersService & RunHandlersService;
  runContextService?: RunContextHandlersService;
  planService?: PlanHandlersService;
  toolService?: ToolHandlersService;
  recoveryService?: RecoveryService;
  artifactService?: ArtifactHandlersService;
  memoryService?: MemoryHandlersService;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  registerWindowHandlers();
  registerProviderHandlers(undefined, { logger: options.logger });

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
}
