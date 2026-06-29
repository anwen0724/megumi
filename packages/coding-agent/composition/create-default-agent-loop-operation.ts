// Composes the standalone AgentLoopOperation with product persistence defaults.
import { AgentLoopOperation } from '../product-runtime';
import type {
  AgentInstructionSourcePort,
  ModelInputGlobalInstructionDirectoryProvider,
  RunBaselineContextPort,
} from '../context';
import { ModelInputSourceOverrideService } from '../context';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createAgentLoopOperationCompositionIds } from './agent-loop-operation-ids';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { createAgentLoopOperationRepositoryOptions } from './agent-loop-operation-repository-options';
import { PermissionSnapshotService } from '../permissions';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import { createAgentLoopOperationToolRepositoryAdapter } from './agent-loop-operation-tool-repository-adapter';

export interface CreateDefaultAgentLoopOperationOptions {
  contextService?: RunBaselineContextPort;
  toolRuntimeFactory?: ToolRuntimeFactory;
  agentInstructionSourceService?: AgentInstructionSourcePort;
}

export interface CreateDefaultAgentLoopOperationHomePaths {
  homePath: string;
  sqlitePath: string;
}

export function createDefaultAgentLoopOperation(
  homePaths: CreateDefaultAgentLoopOperationHomePaths,
  options: CreateDefaultAgentLoopOperationOptions = {},
): AgentLoopOperation {
  const persistence = composeCodingAgentPersistence({ sqlitePath: homePaths.sqlitePath });
  const permissionSnapshotRepository = persistence.permissionSnapshotRepository;
  const activePathRepository = persistence.activePathRepository;
  const toolRepository = persistence.toolRepository;
  const ids = createAgentLoopOperationCompositionIds();
  const agentLoopOperationRepositoryOptions = createAgentLoopOperationRepositoryOptions(persistence);

  const agentLoopOperation = new AgentLoopOperation({
    ...agentLoopOperationRepositoryOptions,
    postRunHooks: new PostRunHooksCoordinator({
      repository: agentLoopOperationRepositoryOptions.postRunHooksRepository,
      megumiHomePath: homePaths.homePath,
    }),
    runTerminalCoordinator: new RunTerminalCoordinator({
      repository: agentLoopOperationRepositoryOptions.runTerminalRepository,
      toolRepository,
      ids,
    }),
    runRetryCoordinator: new RunRetryCoordinator({
      repository: agentLoopOperationRepositoryOptions.runRetryRepository,
      activePathRepository,
      ids,
    }),
    sessionCompactionRepository: persistence.sessionContextRepository,
    activePathRepository,
    toolRepository: createAgentLoopOperationToolRepositoryAdapter(toolRepository),
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
  agentLoopOperation.cleanupInterruptedRunsOnStartup();
  return agentLoopOperation;
}

function defaultGlobalInstructionDirectoryProvider(homePath: string): ModelInputGlobalInstructionDirectoryProvider {
  return {
    listGlobalInstructionDirs: () => [homePath],
  };
}
