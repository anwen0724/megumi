// Composes the complete Coding Agent product runtime without depending on any UI shell.
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService } from '../artifacts';
import type { CodingAgentProductRuntime } from '../product-runtime';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { composeCodingAgentToolRegistry, composeCodingAgentToolRuntimeFactory, composeCodingAgentToolService } from './compose-coding-agent-tool-runtime';
import { composeCodingAgentSessionRuntime, type CodingAgentHomePaths } from './compose-coding-agent-session-runtime';
import { composeCodingAgentMemory } from './compose-coding-agent-memory';
import { composeCodingAgentRecoveryRuntime } from './compose-coding-agent-recovery-runtime';
import type { RuntimeLogger } from '../ports';
import type { SessionRunModelStepProvider } from '../run/session-run-service';
import type { MemorySettingsProvider } from './compose-coding-agent-memory';
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';
import { ProviderSettingsService, type ProviderSettingsAppSettingsPort } from '../settings';

export interface ComposeCodingAgentRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  runtimeLogger: RuntimeLogger;
  modelStepProviderService: SessionRunModelStepProvider;
  appSettingsProvider: ProviderSettingsAppSettingsPort;
  memorySettingsProvider: MemorySettingsProvider;
  permissionSettingsProvider: PermissionSettingsProvider;
  chatStreamEventSink?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['workspaceChangeFooterProjector'];
}

export function composeCodingAgentRuntime(options: ComposeCodingAgentRuntimeOptions): CodingAgentProductRuntime {
  const persistence = composeCodingAgentPersistence({ sqlitePath: options.homePaths.sqlitePath });
  const toolRegistry = composeCodingAgentToolRegistry();
  const memory = composeCodingAgentMemory({
    repository: persistence.memoryRepository,
    modelStepProvider: options.modelStepProviderService,
    memorySettingsProvider: options.memorySettingsProvider,
    runtimeLogger: options.runtimeLogger,
    megumiHomePath: options.homePaths.homePath,
  });
  const toolRuntimeFactory = composeCodingAgentToolRuntimeFactory({
    toolRepository: persistence.toolRepository,
    toolRegistry,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    sessionRunRepository: persistence.sessionRunRepository,
    permissionSettingsProvider: options.permissionSettingsProvider,
  });
  const sessionRuntime = composeCodingAgentSessionRuntime({
    homePaths: options.homePaths,
    runtimeLogger: options.runtimeLogger,
    artifactRepository: persistence.artifactRepository,
    permissionSnapshotRepository: persistence.permissionSnapshotRepository,
    sessionRunRepository: persistence.sessionRunRepository,
    activePathRepository: persistence.activePathRepository,
    toolRepository: persistence.toolRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    timelineMessageRepository: persistence.timelineMessageRepository,
    toolRegistry,
    modelStepProviderService: options.modelStepProviderService,
    toolRuntimeFactory,
    memoryRuntime: memory.memoryRuntime,
    runContextRepository: persistence.runContextRepository,
    chatStreamEventSink: options.chatStreamEventSink,
    workspaceChangeFooterProjector: options.workspaceChangeFooterProjector,
  });
  const toolService = composeCodingAgentToolService({
    toolRegistry,
    toolRepository: persistence.toolRepository,
    resumeApproval: (request) => sessionRuntime.sessionRunService.resumeApproval(request),
  });
  const providerSettingsService = new ProviderSettingsService({
    settings: options.appSettingsProvider,
    env: process.env,
  });
  const artifactContentStore = new ArtifactContentStore({
    artifactRoot: `${options.homePaths.homePath}/artifacts`,
  });
  const artifactService = new ArtifactService({
    repository: persistence.artifactRepository,
    contentStore: artifactContentStore,
  });
  const recoveryService = composeCodingAgentRecoveryRuntime({
    recoveryRepository: persistence.recoveryRepository,
    sessionRunRepository: persistence.sessionRunRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    sessionRunService: sessionRuntime.sessionRunService,
  });

  return {
    sessionRunService: sessionRuntime.sessionRunService,
    recoveryService,
    toolService,
    artifactService,
    memoryService: memory.memoryService,
    runContextService: sessionRuntime.runContextService,
    providerSettingsService,
    dispose: () => persistence.database.close(),
  };
}
