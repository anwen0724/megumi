// Composes the standalone input runtime with product persistence defaults.
import { InputProcessingService } from '../input/input-service';
import type {
  AgentInstructionSourcePort,
  ModelInputGlobalInstructionDirectoryProvider,
  RunBaselineContextPort,
} from '../context';
import { ModelInputSourceOverrideService } from '../context';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createInputProcessingCompositionIds } from './input-processing-ids';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { PermissionSnapshotService } from '../permissions';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';

export interface CreateDefaultInputProcessingServiceOptions {
  contextService?: RunBaselineContextPort;
  toolRuntimeFactory?: ToolRuntimeFactory;
  agentInstructionSourceService?: AgentInstructionSourcePort;
}

export interface CreateDefaultInputProcessingServiceHomePaths {
  homePath: string;
  sqlitePath: string;
}

export function createDefaultInputProcessingService(
  homePaths: CreateDefaultInputProcessingServiceHomePaths,
  options: CreateDefaultInputProcessingServiceOptions = {},
): InputProcessingService {
  const persistence = composeCodingAgentPersistence({ sqlitePath: homePaths.sqlitePath });
  const agentLoopRepository = persistence.agentLoopRepository as any;
  const sessionRepository = persistence.sessionRepository as any;
  const toolCallRepository = persistence.toolCallRepository;
  const ids = createInputProcessingCompositionIds();

  const inputProcessingService = new InputProcessingService({
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
    sessionCompactionRepository: sessionRepository,
    activePathRepository: sessionRepository,
    toolCallRepository,
    toolRegistrySnapshotService: new ToolRegistrySnapshotService({
      getToolSource: (sourceId) => toolCallRepository.getToolSource(sourceId),
      listToolSources: () => toolCallRepository.listToolSources(),
      seedDefaultToolSources: (createdAt) => toolCallRepository.seedDefaultToolSources(createdAt),
      getToolRegistrySnapshotByRun: (runId) => toolCallRepository.getToolRegistrySnapshotByRun(runId),
      saveToolRegistrySnapshot: (snapshot) => agentLoopRepository.saveToolRegistrySnapshot(snapshot),
    }),
    permissionSnapshotService: new PermissionSnapshotService({ repository: agentLoopRepository }),
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
  inputProcessingService.cleanupInterruptedInputsOnStartup();
  return inputProcessingService;
}

function defaultGlobalInstructionDirectoryProvider(homePath: string): ModelInputGlobalInstructionDirectoryProvider {
  return {
    listGlobalInstructionDirs: () => [homePath],
  };
}

