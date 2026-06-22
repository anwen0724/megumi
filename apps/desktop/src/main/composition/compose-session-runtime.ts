// Composes the Desktop Main session run service and its immediate runtime collaborators.
import { ArtifactRepository } from '@megumi/desktop/main/persistence/repos/artifact.repo';
import { PermissionSnapshotRepository } from '@megumi/desktop/main/persistence/repos/permission-snapshot.repo';
import { SessionActivePathRepository } from '@megumi/desktop/main/persistence/repos/session-active-path.repo';
import { SessionRunRepository } from '@megumi/desktop/main/persistence/repos/session-run.repo';
import { TimelineMessageRepository } from '@megumi/desktop/main/persistence/repos/timeline-message.repo';
import { ToolRepository } from '@megumi/desktop/main/persistence/repos/tool.repo';
import { WorkspaceChangeRepository } from '@megumi/desktop/main/persistence/repos/workspace-change.repo';
import type { ToolRegistry } from '@megumi/coding-agent/tools/registry';
import { forwardChatStreamEvent } from '../ipc/chat-stream-event-forwarder';
import { PermissionSnapshotService } from '../services/security/permission-snapshot.service';
import { createDefaultRunContextService } from '../services/runtime/run-context.service';
import type { RuntimeLogger } from '../services/runtime/runtime-logger.service';
import type { ModelStepProviderService } from '../services/runtime/model-step-provider.service';
import { SessionRunService, type SessionRunToolRuntimeFactory } from '../services/session/session-run.service';
import type { RunContextRepository } from '@megumi/desktop/main/persistence/repos/run-context.repo';
import { ToolRegistrySnapshotService } from '@megumi/coding-agent/tools/tool-registry-snapshot';
import { PlanArtifactCompatibilityService } from '@megumi/coding-agent/artifacts';
import { TimelineHistoryCommitProjectorService } from '../projections/timeline/timeline-history-commit-projector.service';
import { createDesktopAgentInstructionSourceService } from '../services/session/agent-instruction-source.service';
import { createWorkspaceChangeFooterProjectorService } from '../projections/workspace/workspace-change-footer-projector.service';
import type { MegumiHomePaths } from '../services/project/megumi-home.service';
import type { AppSettingsService } from '../services/settings/app-settings.service';
import { electronWindowHost, type DesktopWindowHost } from '../host/electron-window-host';

export interface ComposeSessionRuntimeOptions {
  megumiHomePaths: MegumiHomePaths;
  runtimeLogger: RuntimeLogger;
  appSettingsService: AppSettingsService;
  artifactRepository: ArtifactRepository;
  permissionSnapshotRepository: PermissionSnapshotRepository;
  sessionRunRepository: SessionRunRepository;
  activePathRepository: SessionActivePathRepository;
  toolRepository: ToolRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  timelineMessageRepository: TimelineMessageRepository;
  toolRegistry: ToolRegistry;
  modelStepProviderService: ModelStepProviderService;
  toolRuntimeFactory: SessionRunToolRuntimeFactory;
  memoryRuntime: ReturnType<typeof import('./compose-memory-runtime').composeMemoryRuntime>['memoryRuntime'];
  runContextRepository?: RunContextRepository;
  windowHost?: DesktopWindowHost;
}

export function composeSessionRuntime(options: ComposeSessionRuntimeOptions) {
  const windowHost = options.windowHost ?? electronWindowHost;
  const runContextService = createDefaultRunContextService(options.megumiHomePaths, {
    ...(options.runContextRepository ? { repository: options.runContextRepository } : {}),
  });
  const planArtifactCompatibility = new PlanArtifactCompatibilityService({
    repository: options.artifactRepository,
  });
  const permissionSnapshotService = new PermissionSnapshotService({
    repository: options.permissionSnapshotRepository,
    planArtifactCompatibility,
  });
  const agentInstructionSourceService = createDesktopAgentInstructionSourceService();
  const workspaceChangeFooterProjector = createWorkspaceChangeFooterProjectorService({
    workspaceChanges: options.workspaceChangeRepository,
  });
  const chatStreamSink = new TimelineHistoryCommitProjectorService({
    repository: options.timelineMessageRepository,
    downstream: {
      publish(event) {
        for (const window of windowHost.getAllWindows()) {
          forwardChatStreamEvent(window.webContents, event, { logger: options.runtimeLogger });
        }
      },
    },
    ids: {
      diagnosticId: () => `timeline-diagnostic:${crypto.randomUUID()}`,
    },
  });
  const sessionRunService = new SessionRunService({
    repository: options.sessionRunRepository,
    activePathRepository: options.activePathRepository,
    permissionSnapshotService,
    toolRegistrySnapshotService: new ToolRegistrySnapshotService(options.toolRepository),
    contextService: runContextService,
    modelStepProvider: options.modelStepProviderService,
    agentInstructionSourceService,
    toolRuntimeFactory: options.toolRuntimeFactory,
    toolDefinitionProvider: options.toolRegistry,
    toolRepository: options.toolRepository,
    workspaceChanges: options.workspaceChangeRepository,
    chatStreamEventSink: chatStreamSink,
    timelineMessageRepository: options.timelineMessageRepository,
    memoryRecallService: options.memoryRuntime.recallService,
    memoryCaptureService: options.memoryRuntime.captureService,
    memorySettingsProvider: {
      isMemoryEnabled() {
        return options.appSettingsService.getResolvedSettings().memory.enabled;
      },
    },
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.megumiHomePaths.homePath,
  });

  return {
    runContextService,
    sessionRunService,
    chatStreamSink,
    workspaceChangeFooterProjector,
  };
}
