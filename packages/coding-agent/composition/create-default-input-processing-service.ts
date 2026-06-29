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
import { createInputProcessingRepositoryOptions } from './input-processing-repository-options';
import { PermissionSnapshotService } from '../permissions';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import { createInputProcessingToolRepositoryAdapter } from './input-processing-tool-repository-adapter';

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
  const permissionSnapshotRepository = persistence.permissionSnapshotRepository;
  const activePathRepository = persistence.activePathRepository;
  const toolRepository = persistence.toolRepository;
  const ids = createInputProcessingCompositionIds();
  const inputProcessingRepositoryOptions = createInputProcessingRepositoryOptions(persistence);

  const inputProcessingService = new InputProcessingService({
    ...inputProcessingRepositoryOptions,
    postRunHooks: new PostRunHooksCoordinator({
      repository: inputProcessingRepositoryOptions.postRunHooksRepository,
      megumiHomePath: homePaths.homePath,
    }),
    runTerminalCoordinator: new RunTerminalCoordinator({
      repository: inputProcessingRepositoryOptions.runTerminalRepository,
      toolRepository,
      ids,
    }),
    runRetryCoordinator: new RunRetryCoordinator({
      repository: inputProcessingRepositoryOptions.runRetryRepository,
      activePathRepository,
      ids,
    }),
    sessionCompactionRepository: persistence.sessionContextRepository,
    activePathRepository,
    toolRepository: createInputProcessingToolRepositoryAdapter(toolRepository),
    toolRegistrySnapshotService: new ToolRegistrySnapshotService(toolRepository),
    permissionSnapshotService: new PermissionSnapshotService({ repository: permissionSnapshotRepository }),
    planArtifactService: new PlanArtifactService({ repository: permissionSnapshotRepository }),
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

