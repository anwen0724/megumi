import { ipcMain } from 'electron';
import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
import { registerSessionHandlers, type SessionHandlersService } from './handlers/session.handler';
import { registerRunHandlers, type RunHandlersService } from './handlers/run.handler';
import { registerChatHandlers, type ChatHandlersService } from './handlers/chat.handler';
import { registerAgentHandlers, type AgentHandlersService } from './handlers/agent.handler';
import {
  registerAgentContextHandlers,
  type AgentContextHandlersService,
} from './handlers/agent-context.handler';
import {
  registerAgentPlanHandlers,
  type AgentPlanHandlersService,
} from './handlers/agent-plan.handler';
import {
  registerAgentToolHandlers,
  type AgentToolHandlersService,
} from './handlers/agent-tool.handler';
import { registerAgentRecoveryHandlers } from './handlers/agent-recovery.handler';
import {
  registerAgentArtifactHandlers,
  type AgentArtifactHandlersService,
} from './handlers/agent-artifact.handler';
import {
  registerAgentMemoryHandlers,
  type AgentMemoryHandlersService,
} from './handlers/agent-memory.handler';
import type { AgentRecoveryService } from '../services/agent-recovery.service';
import type { RuntimeLogger } from '../services/runtime-logger.service';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  sessionRunService?: SessionHandlersService & RunHandlersService & ChatHandlersService;
  agentService?: AgentHandlersService;
  agentContextService?: AgentContextHandlersService;
  agentPlanService?: AgentPlanHandlersService;
  agentToolService?: AgentToolHandlersService;
  agentRecoveryService?: AgentRecoveryService;
  agentArtifactService?: AgentArtifactHandlersService;
  agentMemoryService?: AgentMemoryHandlersService;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  registerWindowHandlers();
  registerProviderHandlers(undefined, { logger: options.logger });

  if (options.sessionRunService) {
    registerSessionHandlers(options.sessionRunService, { logger: options.logger });
    registerRunHandlers(options.sessionRunService, { logger: options.logger });
    registerChatHandlers(options.sessionRunService, { logger: options.logger });
  }

  if (options.agentService) {
    registerAgentHandlers(options.agentService, { logger: options.logger });
  }

  if (options.agentContextService) {
    registerAgentContextHandlers(options.agentContextService, { logger: options.logger });
  }

  if (options.agentPlanService) {
    registerAgentPlanHandlers(options.agentPlanService, { logger: options.logger });
  }

  if (options.agentToolService) {
    registerAgentToolHandlers(options.agentToolService, { logger: options.logger });
  }

  if (options.agentRecoveryService) {
    registerAgentRecoveryHandlers(options.agentRecoveryService, { logger: options.logger });
  }

  if (options.agentArtifactService) {
    registerAgentArtifactHandlers(options.agentArtifactService, { logger: options.logger });
  }

  if (options.agentMemoryService) {
    registerAgentMemoryHandlers({
      ipcMain,
      agentMemoryService: options.agentMemoryService,
      logger: options.logger,
    });
  }
}
