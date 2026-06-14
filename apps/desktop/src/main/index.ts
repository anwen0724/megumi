import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { RecoveryRepository } from '@megumi/db/repos/recovery.repo';
import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { ArtifactRepository } from '@megumi/db/repos/artifact.repo';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import { TimelineMessageRepository } from '@megumi/db/repos/timeline-message.repo';
import { WorkspaceChangeRepository } from '@megumi/db/repos/workspace-change.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { createChatStreamEvent } from '@megumi/shared/chat-stream';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import { loadEnvFile } from './config/env';
import { initializeElectronMegumiHomeSync } from './services/project/megumi-home.service';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { createRuntimeJsonlLoggerForMegumiHome } from './services/runtime/runtime-logger.service';
import { SessionRunService, type SessionRunToolRuntimeFactory } from './services/session/session-run.service';
import { forwardChatStreamEvent } from './ipc/chat-stream-event-forwarder';
import { createModelStepProviderService } from './services/runtime/model-step-provider.service';
import { ProviderRuntimeService } from './services/provider/provider-runtime.service';
import { ProviderSettingsService } from './services/provider/provider-settings.service';
import { PermissionSnapshotService } from './services/security/permission-snapshot.service';
import { createDefaultRunContextService } from './services/runtime/run-context.service';
import { ToolService } from './services/tool/tool.service';
import { createToolCallHandlerService } from './services/tool/tool-call-handler.service';
import { createProjectToolExecutor } from './services/tool/project-tool-executor.service';
import { WorkspaceChangeTrackerService } from './services/workspace/workspace-change-tracker.service';
import { WorkspaceRestoreService } from './services/workspace/workspace-restore.service';
import { createPermissionSettingsService } from './services/security/permission-settings.service';
import { createRecoveryService } from './services/runtime/recovery.service';
import { createAppSettingsService } from './services/settings/app-settings.service';
import { ArtifactContentStore } from './services/artifact/artifact-content-store.service';
import { ArtifactService } from './services/artifact/artifact.service';
import { createMemoryService } from './services/memory/memory.service';
import { MemoryDiagnosticWriter } from './services/memory/memory-diagnostic-writer.service';
import { MemoryMarkdownSyncService } from './services/memory/memory-markdown-sync.service';
import { MemoryRecallRuntimeService } from './services/memory/memory-recall-runtime.service';
import { MemoryRuntimeCaptureService } from './services/memory/memory-runtime-capture.service';
import { MemoryExtractionModelClientService } from './services/memory/memory-extraction-model-client.service';
import { createNodeMemoryRuntimeFileSystem } from './services/memory/memory-runtime-file-system';
import { PlanArtifactCompatibilityService } from './services/artifact/plan-artifact-compatibility.service';
import { TimelineHistoryCommitProjectorService } from './services/session/timeline-history-commit-projector.service';
import { AgentInstructionSourceService } from './services/session/agent-instruction-source.service';
import fs from 'fs-extra';
import { BrowserWindow, dialog } from 'electron';
import { ProjectRepository } from '@megumi/db/repos/project.repo';
import { createProjectService } from './services/project/project.service';
import { createWorkspaceFilesService } from './services/workspace/workspace-files.service';
import { createWorkspaceRootAuthorizer } from './services/security/workspace-root-authorization.service';
import { createWorkspaceChangeFooterProjectorService } from './services/workspace/workspace-change-footer-projector.service';

loadEnvFile();
const megumiHomePaths = initializeElectronMegumiHomeSync();
const appSettingsService = createAppSettingsService({
  settingsPath: megumiHomePaths.settingsPath,
});
const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
const runContextService = createDefaultRunContextService(megumiHomePaths);
const database = createDatabase(path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3'));
migrateDatabase(database);
const toolRepository = new ToolRepository(database);
const toolRegistry = createBuiltInToolRegistry();
const permissionSettingsService = createPermissionSettingsService({
  userSettingsPath: megumiHomePaths.settingsPath,
  fileSystem: fs,
});
const projectService = createProjectService({
  repository: new ProjectRepository(database),
  chooseDirectory: () => dialog.showOpenDialog({
    properties: ['openDirectory'],
  }),
  fileSystem: fs,
});
const artifactRepository = new ArtifactRepository(database);
const memoryRepository = new MemoryRepository(database);
const planArtifactCompatibility = new PlanArtifactCompatibilityService({
  repository: artifactRepository,
});
const permissionSnapshotService = new PermissionSnapshotService({
  repository: new PermissionSnapshotRepository(database),
  planArtifactCompatibility,
});
const providerSettingsService = new ProviderSettingsService({
  settings: appSettingsService,
});
const providerRuntimeService = new ProviderRuntimeService({
  settings: providerSettingsService,
});
const modelStepProviderService = createModelStepProviderService(providerRuntimeService);
const memoryRuntime = createMemoryRuntime(memoryRepository, modelStepProviderService);
if (appSettingsService.getResolvedSettings().memory.enabled) {
  void memoryRuntime.markdownSyncService.syncUserMirrorOnAppStart({
    homePath: megumiHomePaths.homePath,
  }).catch((error) => {
    runtimeLogger.warn('memory_user_markdown_startup_sync_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
const agentInstructionSourceService = new AgentInstructionSourceService();
const timelineMessageRepository = new TimelineMessageRepository(database);
const sessionRunRepository = new SessionRunRepository(database);
const activePathRepository = new SessionActivePathRepository(database);
const workspaceChangeRepository = new WorkspaceChangeRepository(database);
const workspaceChangeFooterProjector = createWorkspaceChangeFooterProjectorService({
  workspaceChanges: workspaceChangeRepository,
});
const chatStreamSink = new TimelineHistoryCommitProjectorService({
  repository: timelineMessageRepository,
  downstream: {
    publish(event) {
      for (const window of BrowserWindow.getAllWindows()) {
        forwardChatStreamEvent(window.webContents, event, { logger: runtimeLogger });
      }
    },
  },
  ids: {
    diagnosticId: () => `timeline-diagnostic:${crypto.randomUUID()}`,
  },
});
const toolRuntimeFactory: SessionRunToolRuntimeFactory = {
  async create({ projectRoot, permissionMode }) {
    const workspaceChangeTracker = new WorkspaceChangeTrackerService({
      projectRoot,
      fileSystem: fs,
      repository: workspaceChangeRepository,
      ids: {
        changeSetId: () => `workspace-change-set:${crypto.randomUUID()}`,
        workspaceCheckpointId: () => `workspace-checkpoint:${crypto.randomUUID()}`,
        snapshotContentRefId: () => `workspace-snapshot:${crypto.randomUUID()}`,
        changedFileId: () => `workspace-changed-file:${crypto.randomUUID()}`,
      },
    });
    return createToolCallHandlerService({
      registry: toolRegistry,
      repository: {
        saveToolCall: (toolCall) => toolRepository.saveToolCall(toolCall),
        getToolCall: (toolCallId) => toolRepository.getToolCall(toolCallId),
        saveToolExecution: (toolExecution) => toolRepository.saveToolExecution(toolExecution),
        getToolExecution: (toolExecutionId) => toolRepository.getToolExecution(toolExecutionId),
        savePermissionDecision: (permissionDecision) => toolRepository.savePermissionDecision(permissionDecision),
        saveApprovalRequest: (approvalRequest) => toolRepository.saveApprovalRequest(approvalRequest),
        getApprovalRequest: (approvalRequestId) => toolRepository.getApprovalRequest(approvalRequestId),
        saveToolResult: (toolResult) => toolRepository.saveToolResult(toolResult),
        getRunSessionId(runId) {
          const run = sessionRunRepository.getRun(runId);
          return run ? String(run.sessionId) : undefined;
        },
      },
      permissionMode,
      projectRoot,
      settings: await permissionSettingsService.loadForProject(projectRoot),
      projectExecutor: createProjectToolExecutor({
        projectRoot,
        workspaceChangeTracker,
      }),
    });
  },
};
const sessionRunService = new SessionRunService({
  repository: sessionRunRepository,
  activePathRepository,
  permissionSnapshotService: permissionSnapshotService,
  contextService: runContextService,
  modelStepProvider: modelStepProviderService,
  agentInstructionSourceService,
  toolRuntimeFactory,
  toolDefinitionProvider: toolRegistry,
  toolRepository,
  workspaceChanges: workspaceChangeRepository,
  chatStreamEventSink: chatStreamSink,
  timelineMessageRepository,
  memoryRecallService: memoryRuntime.recallService,
  memoryCaptureService: memoryRuntime.captureService,
  memorySettingsProvider: {
    isMemoryEnabled() {
      return appSettingsService.getResolvedSettings().memory.enabled;
    },
  },
  memoryMarkdownSyncService: memoryRuntime.markdownSyncService,
  megumiHomePath: megumiHomePaths.homePath,
});
const toolService = new ToolService({
  repository: toolRepository,
  registry: toolRegistry,
  resumeApproval: (input) => sessionRunService.resumeApproval(input),
});
const workspaceFilesService = createWorkspaceFilesService({
  isWorkspaceRootAllowed: createWorkspaceRootAuthorizer({
    staticRoots: [process.cwd()],
    sessionSource: sessionRunService,
    projectSource: projectService,
  }),
});
const artifactContentStore = new ArtifactContentStore({
  artifactRoot: path.join(megumiHomePaths.homePath, 'artifacts'),
});
const artifactService = new ArtifactService({
  repository: artifactRepository,
  contentStore: artifactContentStore,
});
const memoryService = createMemoryService({
  repository: memoryRepository,
  now: () => new Date().toISOString(),
  createId: (prefix) => `${prefix}:${crypto.randomUUID()}`,
  emitRuntimeEvent: (event) => runtimeLogger.info('runtime.memory.event', {
    eventId: event.eventId,
    eventType: event.eventType,
    runId: event.runId,
    sessionId: event.sessionId,
  }),
});
function createWorkspaceRestoreForChangeSet(changeSetId: string): WorkspaceRestoreService {
  const changeSet = workspaceChangeRepository.getChangeSet(changeSetId);
  if (!changeSet) {
    throw new Error(`Workspace change set not found: ${changeSetId}`);
  }

  const run = sessionRunRepository.getRun(changeSet.runId);
  if (!run) {
    throw new Error(`Workspace restore requires run: ${changeSet.runId}`);
  }

  const session = sessionRunRepository.getSession(String(run.sessionId));
  if (!session?.workspacePath) {
    throw new Error(`Workspace restore requires workspacePath for session: ${run.sessionId}`);
  }

  return new WorkspaceRestoreService({
    projectRoot: session.workspacePath,
    fileSystem: fs,
    repository: workspaceChangeRepository,
    ids: {
      restoreRequestId: () => `workspace-restore-request:${crypto.randomUUID()}`,
      restoreResultId: () => `workspace-restore-result:${crypto.randomUUID()}`,
      restoreFileResultId: () => `workspace-restore-file-result:${crypto.randomUUID()}`,
    },
  });
}

function createMemoryRuntime(
  repository: MemoryRepository,
  modelStepProvider: typeof modelStepProviderService,
): {
  recallService: MemoryRecallRuntimeService;
  captureService: MemoryRuntimeCaptureService;
  markdownSyncService: MemoryMarkdownSyncService;
} {
  const fileSystem = createNodeMemoryRuntimeFileSystem();
  const diagnostics = new MemoryDiagnosticWriter({
    fileSystem,
    logger: runtimeLogger,
  });
  const markdownSync = new MemoryMarkdownSyncService({
    repository,
    fileSystem,
    diagnostics,
    clock: { now: () => new Date().toISOString() },
    ids: {
      memoryId: () => `memory:${crypto.randomUUID()}`,
      auditId: () => `memory-audit:${crypto.randomUUID()}`,
    },
  });
  const extractionClient = new MemoryExtractionModelClientService({
    modelStepProvider,
    clock: { now: () => new Date().toISOString() },
    ids: {
      requestId: () => `memory-extraction-request:${crypto.randomUUID()}`,
      contextId: () => `memory-extraction-context:${crypto.randomUUID()}`,
      traceId: () => `memory-extraction-trace:${crypto.randomUUID()}`,
    },
  });

  return {
    markdownSyncService: markdownSync,
    recallService: new MemoryRecallRuntimeService({
      repository,
      markdownSync,
      diagnostics,
      clock: { now: () => new Date().toISOString() },
      ids: {
        recallRequestId: () => `memory-recall-request:${crypto.randomUUID()}`,
        snapshotId: () => `memory-recall-snapshot:${crypto.randomUUID()}`,
        accessLogId: () => `memory-access:${crypto.randomUUID()}`,
        auditId: () => `memory-audit:${crypto.randomUUID()}`,
      },
    }),
    captureService: new MemoryRuntimeCaptureService({
      repository,
      markdownSync,
      diagnostics,
      extractionClient,
      clock: { now: () => new Date().toISOString() },
      ids: {
        memoryId: () => `memory:${crypto.randomUUID()}`,
        auditId: () => `memory-audit:${crypto.randomUUID()}`,
      },
    }),
  };
}

const recoveryService = createRecoveryService({
  repository: new RecoveryRepository(database),
  clock: () => new Date(),
  ids: {
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    interruptedMarkerId: (runId) => `interrupted-marker:${runId}:${crypto.randomUUID()}`,
  },
  workspaceChanges: workspaceChangeRepository,
  workspaceRestore: {
    restoreChangeSet(input) {
      return createWorkspaceRestoreForChangeSet(input.changeSetId).restoreChangeSet(input);
    },
  },
  appendRuntimeEvent: (event) => {
    sessionRunRepository.appendRuntimeEvent(event);
  },
  publishWorkspaceChangeFooter: (runId, createdAt) => {
    const footer = workspaceChangeFooterProjector.projectRunFooter(runId);
    const run = sessionRunRepository.getRun(runId);
    const session = run ? sessionRunRepository.getSession(String(run.sessionId)) : undefined;
    if (!footer || !run || !session) {
      return;
    }

    chatStreamSink.publish(createChatStreamEvent({
      eventId: `chat-stream-event:${crypto.randomUUID()}`,
      eventType: 'workspace.change.footer.updated',
      projectId: String(session.workspaceId ?? session.sessionId),
      sessionId: String(session.sessionId),
      runId,
      streamId: `chat-stream:${runId}:workspace-change-footer`,
      streamKind: 'workspace-change-footer',
      seq: 1,
      createdAt,
      footer,
    }));
  },
  nextRuntimeSequence: (runId) => nextPersistedRuntimeSequence(
    sessionRunRepository.listRuntimeEventsByRun(runId),
  ),
});
registerRuntimeProcessErrorHandlers({ logger: runtimeLogger });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

registerAppLifecycle({
  runMigrations: () => megumiHomePaths,
  registerAllHandlers: () => registerAllHandlers({
    logger: runtimeLogger,
    sessionRunService,
    runContextService,
    planService: sessionRunService,
    toolService,
    recoveryService,
    artifactService,
    memoryService,
    settingsService: appSettingsService,
    projectService,
    workspaceFilesService,
  }),
  createWindow: () => {
    createMainWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    });
  },
});

function nextPersistedRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((maxSequence, event) => Math.max(maxSequence, event.sequence), 0) + 1;
}



