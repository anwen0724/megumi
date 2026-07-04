// Composes the standalone agent-run runtime with product persistence defaults.
import { AgentRunProcessingService } from '../agent-loop';
import type {
  ModelInputGlobalInstructionDirectoryProvider,
} from '../agent-loop/model-input/model-input-source-overrides';
import { ModelInputSourceOverrideService } from '../agent-loop/model-input/model-input-source-overrides';
import type { AgentInstructionSourcePort } from '../adapters/local/context/agent-instruction-source';
import type { RunBaselineContextPort } from '../agent-loop/run-context/run-context-service';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createAgentRunProcessingCompositionIds } from './agent-run-processing-ids';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistryService } from '../tools';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';

export interface CreateDefaultAgentRunProcessingServiceOptions {
  contextService?: RunBaselineContextPort;
  toolRuntimeFactory?: ToolRuntimeFactory;
  agentInstructionSourceService?: AgentInstructionSourcePort;
}

export interface CreateDefaultAgentRunProcessingServiceHomePaths {
  homePath: string;
  sqlitePath: string;
}

export function createDefaultAgentRunProcessingService(
  homePaths: CreateDefaultAgentRunProcessingServiceHomePaths,
  options: CreateDefaultAgentRunProcessingServiceOptions = {},
): AgentRunProcessingService {
  const persistence = composeCodingAgentPersistence({ sqlitePath: homePaths.sqlitePath });
  const agentLoopRepository = persistence.agentLoopRepository as any;
  const sessionRepository = persistence.sessionRepository as any;
  const toolCallRepository = persistence.toolCallRepository;
  const ids = createAgentRunProcessingCompositionIds();

  const agentRunProcessingService = new AgentRunProcessingService({
    sessionRepository,
    agentLoopRepository,
    postRunHooks: new PostRunHooksCoordinator({
      repository: {
        listRuntimeEventsByRun: (runId) => agentLoopRepository.listRuntimeEventsByRun(runId),
      },
      megumiHomePath: homePaths.homePath,
    }),
    runTerminalCoordinator: new RunTerminalCoordinator({
      repository: {
        getRun: (runId) => agentLoopRepository.getRun(runId),
        saveRun: (run) => agentLoopRepository.saveRun(run),
        saveStep: (step) => agentLoopRepository.saveStep(step),
        listStepsByRun: (runId) => agentLoopRepository.listStepsByRun(runId),
        listRunsByStatuses: (statuses) => agentLoopRepository.listRunsByStatuses(statuses),
        listRuntimeEventsByRun: (runId) => agentLoopRepository.listRuntimeEventsByRun(runId),
        appendRuntimeEvent: (event) => agentLoopRepository.appendRuntimeEvent(event),
      },
      toolRepository: toolCallRepository,
      ids,
    }),
    runRetryCoordinator: new RunRetryCoordinator({
      repository: {
        getRun: (runId) => agentLoopRepository.getRun(runId),
        getMessage: (messageId) => sessionRepository.getMessage(messageId),
        listRuntimeEventsByRun: (runId) => agentLoopRepository.listRuntimeEventsByRun(runId),
        appendRuntimeEvent: (event) => agentLoopRepository.appendRuntimeEvent(event),
      },
      activePathRepository: sessionRepository,
      ids,
    }),
    activePathRepository: sessionRepository,
    toolCallRepository,
    toolDefinitionProvider: new ToolRegistryService(),
    planArtifactService: new PlanArtifactService({ repository: agentLoopRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
    ...(options.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    ...(options.agentInstructionSourceService ? { agentInstructionSourceService: options.agentInstructionSourceService } : {}),
    megumiHomePath: homePaths.homePath,
    modelInputSourceOverrideProvider: new ModelInputSourceOverrideService({
      globalInstructionDirectoryProvider: defaultGlobalInstructionDirectoryProvider(homePaths.homePath),
    }),
    ids,
  });
  agentRunProcessingService.cleanupInterruptedInputsOnStartup();
  return agentRunProcessingService;
}

function defaultGlobalInstructionDirectoryProvider(homePath: string): ModelInputGlobalInstructionDirectoryProvider {
  return {
    listGlobalInstructionDirs: () => [homePath],
  };
}
