// Composes Coding Agent session/run product services and their product collaborators.
import { PermissionSnapshotService } from '../run/permissions/permission-snapshot-service';
import { RunContextService } from '../run/context/resources/run-context-service';
import { createLocalWorkspaceSourceProvider } from '../adapters/local/run-context/workspace-source-provider';
import type { RuntimeLogger } from '../product-runtime';
import {
  SessionRunService,
  type SessionRunModelStepProvider,
  type SessionRunToolRuntimeFactory,
} from '../run/session-run-service';
import type { RunContextRepository } from '../persistence/repos/run-context.repo';
import type { ArtifactRepository } from '../persistence/repos/artifact.repo';
import type { PermissionSnapshotRepository } from '../persistence/repos/permission-snapshot.repo';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type { SessionRunRepository } from '../persistence/repos/session-run.repo';
import type { TimelineMessageRepository } from '../persistence/repos/timeline-message.repo';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import type { ToolRegistry } from '../tools/registry';
import { ToolRegistrySnapshotService } from '../tools/tool-registry-snapshot';
import { PlanArtifactCompatibilityService } from '../artifacts';
import type { MemoryRuntimeComposition } from './compose-coding-agent-memory';

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
  sessionRunRepository: SessionRunRepository;
  activePathRepository: SessionActivePathRepository;
  toolRepository: ToolRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  timelineMessageRepository: TimelineMessageRepository;
  toolRegistry: ToolRegistry;
  modelStepProviderService: SessionRunModelStepProvider;
  toolRuntimeFactory: SessionRunToolRuntimeFactory;
  memoryRuntime: MemoryRuntimeComposition['memoryRuntime'];
  runContextRepository: RunContextRepository;
  chatStreamEventSink?: ConstructorParameters<typeof SessionRunService>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: ConstructorParameters<typeof SessionRunService>[0]['workspaceChanges'];
}

export function composeCodingAgentSessionRuntime(options: ComposeCodingAgentSessionRuntimeOptions) {
  const runContextService = new RunContextService({
    contextRepository: options.runContextRepository,
    workspaceSourceProvider: createLocalWorkspaceSourceProvider(),
  });
  const planArtifactCompatibility = new PlanArtifactCompatibilityService({
    repository: options.artifactRepository,
  });
  const permissionSnapshotService = new PermissionSnapshotService({
    repository: options.permissionSnapshotRepository,
    planArtifactCompatibility,
  });
  const sessionRunService = new SessionRunService({
    repository: options.sessionRunRepository,
    activePathRepository: options.activePathRepository,
    permissionSnapshotService,
    toolRegistrySnapshotService: new ToolRegistrySnapshotService(options.toolRepository),
    contextService: runContextService,
    modelStepProvider: options.modelStepProviderService,
    toolRuntimeFactory: options.toolRuntimeFactory,
    toolDefinitionProvider: options.toolRegistry,
    toolRepository: options.toolRepository,
    workspaceChanges: options.workspaceChangeFooterProjector ?? options.workspaceChangeRepository,
    chatStreamEventSink: options.chatStreamEventSink,
    timelineMessageRepository: options.timelineMessageRepository,
    memoryRecallService: options.memoryRuntime.recallService,
    memoryCaptureService: options.memoryRuntime.captureService,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
  });

  return {
    runContextService,
    sessionRunService,
  };
}

