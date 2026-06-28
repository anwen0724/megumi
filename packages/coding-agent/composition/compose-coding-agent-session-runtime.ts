// Composes Coding Agent session/run product services and their product collaborators.
import { PermissionSnapshotService } from '../permissions/permission-snapshot-service';
import { RunContextService } from '../context/resources';
import { createLocalWorkspaceSourceProvider } from '../adapters/local/run-context/workspace-source-provider';
import type { RuntimeLogger } from '../product-runtime';
import {
  AgentRunService,
} from '../run/agent-run-service';
import {
  SessionBranchService,
  SessionContextInputService,
  SessionService,
} from '../session';
import type {
  AgentRunModelStepProvider,
  AgentRunToolRuntimeFactory,
} from '../run/run-contract';
import { createDefaultAgentRunServiceIds } from '../run/agent-run-service-ids';
import type { RunContextRepository } from '../persistence/repos/run-context.repo';
import type { ArtifactRepository } from '../persistence/repos/artifact.repo';
import type { ModelStepRepository } from '../persistence/repos/model-step.repo';
import type { PermissionSnapshotRepository } from '../persistence/repos/permission-snapshot.repo';
import type { RunExecutionFactRepository } from '../persistence/repos/run-execution-fact.repo';
import type { RunRecordRepository } from '../persistence/repos/run-record.repo';
import type { RuntimeEventRepository } from '../persistence/repos/runtime-event.repo';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type { SessionContextRepository } from '../persistence/repos/session-context.repo';
import type { SessionMessageRepository } from '../persistence/repos/session-message.repo';
import type { SessionRecordRepository } from '../persistence/repos/session-record.repo';
import type { TimelineMessageRepository } from '../persistence/repos/timeline-message.repo';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import type { ToolRegistry } from '../tools/registry';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import type { MemoryRuntimeComposition } from './compose-coding-agent-memory';
import { createAgentRunRepositoryOptions } from './agent-run-repository-options';
import { RunCompletionHooksCoordinator } from '../run/completion';
import { RunTerminalCoordinator } from '../state';
import { RunRetryCoordinator } from '../run/lifecycle';
import {
  createWorkspaceChangeFooterProjectorService,
  isWorkspaceChangeFooterProjectorPort,
} from '../workspace';

export interface CodingAgentHomePaths {
  homePath: string;
  sqlitePath: string;
  settingsPath: string;
}

export interface ComposeCodingAgentSessionRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  runtimeLogger: RuntimeLogger;
  artifactRepository: ArtifactRepository;
  permissionSnapshotRepository: PermissionSnapshotRepository;
  modelStepRepository: ModelStepRepository;
  runRecordRepository: RunRecordRepository;
  sessionRecordRepository: SessionRecordRepository;
  sessionContextRepository: SessionContextRepository;
  sessionMessageRepository: SessionMessageRepository;
  runExecutionFactRepository: RunExecutionFactRepository;
  runtimeEventRepository: RuntimeEventRepository;
  activePathRepository: SessionActivePathRepository;
  toolRepository: ToolRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  timelineMessageRepository: TimelineMessageRepository;
  toolRegistry: ToolRegistry;
  modelStepProviderService: AgentRunModelStepProvider;
  toolRuntimeFactory: AgentRunToolRuntimeFactory;
  memoryRuntime: MemoryRuntimeComposition['memoryRuntime'];
  runContextRepository: RunContextRepository;
  chatStreamEventSink?: ConstructorParameters<typeof AgentRunService>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: ConstructorParameters<typeof AgentRunService>[0]['workspaceChanges'];
}

export function composeCodingAgentSessionRuntime(options: ComposeCodingAgentSessionRuntimeOptions) {
  const agentRunRepositoryOptions = createAgentRunRepositoryOptions(options);
  const agentRunIds = createDefaultAgentRunServiceIds();
  const runContextService = new RunContextService({
    contextRepository: options.runContextRepository,
    workspaceSourceProvider: createLocalWorkspaceSourceProvider(),
  });
  const planArtifactCompatibility = new PlanArtifactCompatibilityService({
    repository: options.artifactRepository,
  });
  const permissionSnapshotService = new PermissionSnapshotService({
    repository: options.permissionSnapshotRepository,
  });
  const planArtifactService = new PlanArtifactService({
    repository: options.permissionSnapshotRepository,
    planArtifactCompatibility,
  });
  const sessionService = new SessionService({
    sessionRepository: options.sessionRecordRepository,
    messageRepository: options.sessionMessageRepository,
    runRepository: options.runRecordRepository,
    ids: { sessionId: () => `session:${crypto.randomUUID()}` },
    activePathRepository: options.activePathRepository,
    timelineMessageRepository: options.timelineMessageRepository,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
  });
  const branchIds = {
    branchMarkerId: () => `branch-marker:${crypto.randomUUID()}`,
    sourceEntryId: () => `source-entry:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    chatStreamEventId: () => `chat-stream-event:${crypto.randomUUID()}`,
  };
  const sessionBranchService = new SessionBranchService({
    sessionRepository: options.sessionRecordRepository,
    messageRepository: options.sessionMessageRepository,
    runtimeEventRepository: options.runtimeEventRepository,
    activePathRepository: options.activePathRepository,
    ids: branchIds,
    chatStreamEventSink: options.chatStreamEventSink,
  });
  const sessionContextInputService = new SessionContextInputService({
    sessionRepository: options.sessionRecordRepository,
    messageRepository: options.sessionMessageRepository,
    runRepository: options.runRecordRepository,
    runExecutionFactRepository: options.runExecutionFactRepository,
    runtimeEventRepository: options.runtimeEventRepository,
    sessionCompactionRepository: options.sessionContextRepository,
    activePathRepository: options.activePathRepository,
  });
  const workspaceChanges = options.workspaceChangeFooterProjector ?? options.workspaceChangeRepository;
  const workspaceChangeFooterProjector = isWorkspaceChangeFooterProjectorPort(workspaceChanges)
    ? createWorkspaceChangeFooterProjectorService({ workspaceChanges })
    : undefined;
  const runCompletionHooks = new RunCompletionHooksCoordinator({
    repository: agentRunRepositoryOptions.runCompletionRepository,
    memoryCaptureService: options.memoryRuntime.captureService,
    megumiHomePath: options.homePaths.homePath,
    workspaceChanges,
    ...(workspaceChangeFooterProjector ? { workspaceChangeFooterProjector } : {}),
  });
  const runTerminalCoordinator = new RunTerminalCoordinator({
    repository: agentRunRepositoryOptions.runTerminalRepository,
    toolRepository: options.toolRepository,
    ids: agentRunIds,
  });
  const runRetryCoordinator = new RunRetryCoordinator({
    repository: agentRunRepositoryOptions.runRetryRepository,
    activePathRepository: options.activePathRepository,
    sessionBranchService,
    ids: agentRunIds,
  });
  const agentRunService = new AgentRunService({
    ...agentRunRepositoryOptions,
    runCompletionHooks,
    runTerminalCoordinator,
    runRetryCoordinator,
    sessionCompactionRepository: options.sessionContextRepository,
    activePathRepository: options.activePathRepository,
    sessionContextInputService,
    sessionBranchService,
    permissionSnapshotService,
    planArtifactService,
    toolRegistrySnapshotService: new ToolRegistrySnapshotService(options.toolRepository),
    contextService: runContextService,
    modelStepProvider: options.modelStepProviderService,
    toolRuntimeFactory: options.toolRuntimeFactory,
    toolDefinitionProvider: options.toolRegistry,
    toolRepository: options.toolRepository,
    workspaceChanges,
    chatStreamEventSink: options.chatStreamEventSink,
    memoryRecallService: options.memoryRuntime.recallService,
    memoryCaptureService: options.memoryRuntime.captureService,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
    ids: agentRunIds,
  });

  return {
    runContextService,
    sessionService,
    sessionBranchService,
    agentRunService,
    planArtifactService,
  };
}
