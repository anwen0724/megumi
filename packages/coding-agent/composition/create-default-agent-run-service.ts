// Composes the standalone AgentRunService with product persistence defaults.
import { AgentRunService } from '../run/agent-run-service';
import type {
  AgentRunServiceHomePaths,
} from '../run/run-contract';
import type {
  AgentInstructionSourcePort,
  ModelInputGlobalInstructionDirectoryProvider,
  RunBaselineContextPort,
} from '../context';
import { ModelInputSourceOverrideService } from '../context';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createDefaultAgentRunServiceIds } from '../run/agent-run-service-ids';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { createAgentRunRepositoryOptions } from './agent-run-repository-options';
import { PermissionSnapshotService } from '../permissions';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import { createAgentRunToolRepositoryAdapter } from './agent-run-tool-repository-adapter';

export interface CreateDefaultAgentRunServiceOptions {
  contextService?: RunBaselineContextPort;
  toolRuntimeFactory?: ToolRuntimeFactory;
  agentInstructionSourceService?: AgentInstructionSourcePort;
}

export function createDefaultAgentRunService(
  homePaths: AgentRunServiceHomePaths,
  options: CreateDefaultAgentRunServiceOptions = {},
): AgentRunService {
  const persistence = composeCodingAgentPersistence({ sqlitePath: homePaths.sqlitePath });
  const permissionSnapshotRepository = persistence.permissionSnapshotRepository;
  const activePathRepository = persistence.activePathRepository;
  const toolRepository = persistence.toolRepository;
  const ids = createDefaultAgentRunServiceIds();
  const agentRunRepositoryOptions = createAgentRunRepositoryOptions(persistence);

  const service = new AgentRunService({
    ...agentRunRepositoryOptions,
    postRunHooks: new PostRunHooksCoordinator({
      repository: agentRunRepositoryOptions.postRunHooksRepository,
      megumiHomePath: homePaths.homePath,
    }),
    runTerminalCoordinator: new RunTerminalCoordinator({
      repository: agentRunRepositoryOptions.runTerminalRepository,
      toolRepository,
      ids,
    }),
    runRetryCoordinator: new RunRetryCoordinator({
      repository: agentRunRepositoryOptions.runRetryRepository,
      activePathRepository,
      ids,
    }),
    sessionCompactionRepository: persistence.sessionContextRepository,
    activePathRepository,
    toolRepository: createAgentRunToolRepositoryAdapter(toolRepository),
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
  service.cleanupInterruptedRunsOnStartup();
  return service;
}

function defaultGlobalInstructionDirectoryProvider(homePath: string): ModelInputGlobalInstructionDirectoryProvider {
  return {
    listGlobalInstructionDirs: () => [homePath],
  };
}
