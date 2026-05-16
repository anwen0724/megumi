import { registerWindowHandlers } from './handlers/window.handler';
import { registerProviderHandlers } from './handlers/provider.handler';
import { registerChatHandlers } from './handlers/chat.handler';
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
import type { AgentRecoveryService } from '../services/agent-recovery.service';
import type { RuntimeLogger } from '../services/runtime-logger.service';

export interface RegisterAllHandlersOptions {
  logger?: RuntimeLogger;
  agentService?: AgentHandlersService;
  agentContextService?: AgentContextHandlersService;
  agentPlanService?: AgentPlanHandlersService;
  agentToolService?: AgentToolHandlersService;
  agentRecoveryService?: AgentRecoveryService;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  registerWindowHandlers();
  registerProviderHandlers(undefined, { logger: options.logger });
  registerChatHandlers(undefined, { logger: options.logger });

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
}
