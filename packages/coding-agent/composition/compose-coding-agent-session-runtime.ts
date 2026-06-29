// Composes session-owned services with the product agent-loop operation.
import { PermissionSnapshotService } from '../permissions/permission-snapshot-service';
import { RunContextService } from '../context/resources';
import { createLocalWorkspaceSourceProvider } from '../adapters/local/run-context/workspace-source-provider';
import type { RuntimeLogger } from '../product-runtime';
import {
  AgentLoopOperation,
} from '../product-runtime';
import {
  SessionBranchService,
  SessionContextInputService,
  SessionService,
} from '../session';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createAgentLoopOperationCompositionIds } from './agent-loop-operation-ids';
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
import { createAgentLoopOperationRepositoryOptions } from './agent-loop-operation-repository-options';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import {
  createWorkspaceChangeFooterProjectorService,
  isWorkspaceChangeFooterProjectorPort,
} from '../workspace';
import { createAgentLoopOperationToolRepositoryAdapter } from './agent-loop-operation-tool-repository-adapter';

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
  modelCallProviderService: ModelCallProvider;
  toolRuntimeFactory: ToolRuntimeFactory;
  memoryRuntime: MemoryRuntimeComposition['memoryRuntime'];
  runContextRepository: RunContextRepository;
  chatStreamEventSink?: ConstructorParameters<typeof AgentLoopOperation>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: ConstructorParameters<typeof AgentLoopOperation>[0]['workspaceChanges'];
}

export function composeCodingAgentSessionRuntime(options: ComposeCodingAgentSessionRuntimeOptions) {
  const agentLoopOperationRepositoryOptions = createAgentLoopOperationRepositoryOptions(options);
  const agentLoopOperationIds = createAgentLoopOperationCompositionIds();
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
  const postRunHooks = new PostRunHooksCoordinator({
    repository: agentLoopOperationRepositoryOptions.postRunHooksRepository,
    memoryCaptureService: options.memoryRuntime.captureService,
    megumiHomePath: options.homePaths.homePath,
    workspaceChanges,
    ...(workspaceChangeFooterProjector ? { workspaceChangeFooterProjector } : {}),
  });
  const runTerminalCoordinator = new RunTerminalCoordinator({
    repository: agentLoopOperationRepositoryOptions.runTerminalRepository,
    toolRepository: options.toolRepository,
    ids: agentLoopOperationIds,
  });
  const runRetryCoordinator = new RunRetryCoordinator({
    repository: agentLoopOperationRepositoryOptions.runRetryRepository,
    activePathRepository: options.activePathRepository,
    sessionBranchService,
    ids: agentLoopOperationIds,
  });
  const agentLoopOperation = new AgentLoopOperation({
    ...agentLoopOperationRepositoryOptions,
    postRunHooks,
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
    modelCallProvider: options.modelCallProviderService,
    toolRuntimeFactory: options.toolRuntimeFactory,
    toolDefinitionProvider: options.toolRegistry,
    toolRepository: createAgentLoopOperationToolRepositoryAdapter(options.toolRepository),
    workspaceChanges,
    chatStreamEventSink: options.chatStreamEventSink,
    memoryRecallService: options.memoryRuntime.recallService,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
    ids: agentLoopOperationIds,
  });

  return {
    runContextService,
    sessionService,
    sessionBranchService,
    agentLoopOperation,
    planArtifactService,
  };
}
