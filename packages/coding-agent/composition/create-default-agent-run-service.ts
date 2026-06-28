// Composes the standalone AgentRunService with product persistence defaults.
import { AgentRunService } from '../run/agent-run-service';
import type {
  AgentRunServiceHomePaths,
  SessionRunAgentInstructionSourceService,
  SessionRunContextService,
  AgentRunToolRuntimeFactory,
} from '../run/run-contract';
import { createDefaultAgentRunServiceIds } from '../run/agent-run-service-ids';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { createAgentRunRepositoryOptions } from './agent-run-repository-options';
import { PermissionSnapshotService } from '../permissions';
import { PlanArtifactService } from '../artifacts';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { RunCompletionHooksCoordinator } from '../run/completion';
import { RunTerminalCoordinator } from '../state';
import { RunRetryCoordinator } from '../run/lifecycle';
import { createAgentRunToolRepositoryAdapter } from './agent-run-tool-repository-adapter';

export interface CreateDefaultAgentRunServiceOptions {
  contextService?: SessionRunContextService;
  toolRuntimeFactory?: AgentRunToolRuntimeFactory;
  agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
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
    runCompletionHooks: new RunCompletionHooksCoordinator({
      repository: agentRunRepositoryOptions.runCompletionRepository,
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
    globalInstructionDirectoryProvider: {
      listGlobalInstructionDirs: () => [homePaths.homePath],
    },
    ids,
  });
  service.cleanupInterruptedRunsOnStartup();
  return service;
}
