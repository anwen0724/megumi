// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const homePath = `${process.cwd().replaceAll('\\', '/')}/.tmp/megumi-runtime-logger-review`;
  const logsPath = `${homePath}/logs`;
  const codingAgentRuntime = {
    sessionRunService: {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      sendSessionMessage: vi.fn(),
      cancelSessionMessage: vi.fn(),
      listRuntimeEventsByRun: vi.fn(),
      startRun: vi.fn(),
      getPlanByRun: vi.fn(),
      updatePlanStatus: vi.fn(),
    },
    runContextService: {
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    },
    providerSettingsService: {
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    },
    toolService: {
      listDefinitions: vi.fn(),
      getToolExecution: vi.fn(),
      resolveApproval: vi.fn(),
    },
    recoveryService: {
      listRecoverableRuns: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
    },
    artifactService: {
      listArtifacts: vi.fn(),
    },
    memoryService: {
      listMemories: vi.fn(),
    },
    projectService: {
      listProjects: vi.fn(),
      useExistingProject: vi.fn(),
      openProject: vi.fn(),
      removeProject: vi.fn(),
      listAuthorizedWorkspaceRoots: vi.fn(() => ['C:/all/work/study/megumi']),
    },
    dispose: vi.fn(),
  };
  return {
    homePath,
    logsPath,
    loadEnvFile: vi.fn(),
    initializeElectronMegumiHomeSync: vi.fn(() => ({
      homePath,
      settingsPath: `${homePath}/settings.json`,
      settingsSchemaPath: `${homePath}/settings.schema.json`,
      readmePath: `${homePath}/README.md`,
      versionPath: `${homePath}/version.json`,
      sqlitePath: `${homePath}/sqlite`,
      logsPath,
      cachePath: `${homePath}/cache`,
      tmpPath: `${homePath}/tmp`,
    })),
    registerAllHandlers: vi.fn(),
    registerRuntimeProcessErrorHandlers: vi.fn(),
    registerAppLifecycle: vi.fn(),
    createMainWindow: vi.fn(() => ({
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    })),
    SessionRunRepository: vi.fn(function SessionRunRepository(
      this: {
        database?: unknown;
        getRun?: unknown;
        getSession?: unknown;
        listRuntimeEventsByRun?: unknown;
        appendRuntimeEvent?: unknown;
      },
      database: unknown,
    ) {
      this.database = database;
      this.getRun = vi.fn(() => ({
        runId: 'run_123',
        sessionId: 'session_123',
      }));
      this.getSession = vi.fn(() => ({
        sessionId: 'session_123',
        title: 'Restore Session',
        workspacePath: 'C:/work/project',
        status: 'active',
        createdAt: '2026-06-05T10:00:00.000Z',
        updatedAt: '2026-06-05T10:00:00.000Z',
      }));
      this.listRuntimeEventsByRun = vi.fn(() => []);
      this.appendRuntimeEvent = vi.fn();
    }),
    PermissionSnapshotRepository: vi.fn(function PermissionSnapshotRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    PermissionSnapshotService: vi.fn(function PermissionSnapshotService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        createPermissionSnapshot: vi.fn(),
        linkAcceptedSourcePlan: vi.fn(),
        createPlanRecordForRun: vi.fn(),
        getPlanByRun: vi.fn(),
        updatePlanStatus: vi.fn(),
      };
    }),
    SessionRunService: vi.fn(function SessionRunService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        createSession: vi.fn(),
        listSessions: vi.fn(),
        sendSessionMessage: vi.fn(),
        cancelSessionMessage: vi.fn(),
        listRuntimeEventsByRun: vi.fn(),
        startRun: vi.fn(),
        getPlanByRun: vi.fn(),
        updatePlanStatus: vi.fn(),
      };
    }),
    createModelStepProviderService: vi.fn(() => ({
      streamModelStep: vi.fn(),
      cancelModelStep: vi.fn(),
    })),
    ProviderSettingsService: vi.fn(function ProviderSettingsService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        getProviderSettingsSync: vi.fn(),
        listProviderStatuses: vi.fn(),
        updateProviderSettings: vi.fn(),
        setProviderApiKey: vi.fn(),
        deleteProviderApiKey: vi.fn(),
      };
    }),
    ProviderRuntimeService: vi.fn(function ProviderRuntimeService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
    createAppSettingsService: vi.fn(() => ({
      getResolvedSettings: vi.fn(() => ({
        theme: 'midnight-blue',
        memory: { enabled: false },
        compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
        chat: { defaultProvider: 'deepseek' },
        permissions: {
          defaultMode: 'ask',
          trustedWorkspaceRoots: [],
          toolOverrides: {},
        },
        providers: {},
      })),
      updateSettings: vi.fn(),
    })),
    ToolService: vi.fn(function ToolService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        listDefinitions: vi.fn(),
        getToolCall: vi.fn(),
        resolveApproval: vi.fn(),
      };
    }),
    createDefaultToolService: vi.fn(() => ({
      listDefinitions: vi.fn(),
      getToolCall: vi.fn(),
      resolveApproval: vi.fn(),
    })),
    createDatabase: vi.fn(() => ({ databaseId: 'recovery-database' })),
    migrateDatabase: vi.fn(),
    codingAgentRuntime,
    composeCodingAgentRuntime: vi.fn(() => codingAgentRuntime),
    composeCodingAgentPersistence: vi.fn(() => {
      const db = { databaseId: 'desktop-persistence-database' };
      return {
        database: db,
        sessionRunRepository: new mocks.SessionRunRepository(db),
        activePathRepository: new mocks.SessionActivePathRepository(db),
        recoveryRepository: new mocks.RecoveryRepository(db),
        permissionSnapshotRepository: new mocks.PermissionSnapshotRepository(db),
        toolRepository: new mocks.ToolRepository(db),
        artifactRepository: new mocks.ArtifactRepository(db),
        memoryRepository: new mocks.MemoryRepository(db),
        timelineMessageRepository: new mocks.TimelineMessageRepository(db),
        workspaceChangeRepository: new mocks.WorkspaceChangeRepository(db),
        projectRepository: new mocks.ProjectRepository(db),
        runContextRepository: { repositoryName: 'run-context-repository' },
      };
    }),
    RecoveryRepository: vi.fn(function RecoveryRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    WorkspaceChangeRepository: vi.fn(function WorkspaceChangeRepository(
      this: {
        database?: unknown;
        getChangeSet?: unknown;
        listChangeSummariesByRun?: unknown;
      },
      database: unknown,
    ) {
      this.database = database;
      this.getChangeSet = vi.fn(() => ({
        changeSetId: 'workspace-change-set-1',
        sessionId: 'session_123',
        runId: 'run_123',
        status: 'finalized',
        openedAt: '2026-06-05T10:00:00.000Z',
        finalizedAt: '2026-06-05T10:00:01.000Z',
        changedFileCount: 1,
      }));
      this.listChangeSummariesByRun = vi.fn(() => []);
    }),
    WorkspaceRestoreService: vi.fn(function WorkspaceRestoreService(
      this: { options?: unknown; restoreChangeSet?: unknown },
      options: unknown,
    ) {
      this.options = options;
      this.restoreChangeSet = vi.fn(async (input) => ({
        request: {
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: input.changeSetId,
          sessionId: 'session_123',
          runId: 'run_123',
          requestedBy: input.requestedBy,
          status: 'completed',
          requestedAt: '2026-06-05T10:00:00.000Z',
          completedAt: '2026-06-05T10:00:01.000Z',
        },
        result: {
          restoreResultId: 'workspace-restore-result-1',
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: input.changeSetId,
          sessionId: 'session_123',
          runId: 'run_123',
          status: 'restored',
          restoredAt: '2026-06-05T10:00:01.000Z',
          metadata: {
            changedFileCount: 1,
            restoredCount: 1,
            conflictCount: 0,
            failedCount: 0,
            noopCount: 0,
          },
        },
        fileResults: [],
      }));
    }),
    SessionActivePathRepository: vi.fn(function SessionActivePathRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    ArtifactRepository: vi.fn(function ArtifactRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    ToolRepository: vi.fn(function ToolRepository(
      this: { database?: unknown; getToolExecution?: unknown },
      database: unknown,
    ) {
      this.database = database;
      this.getToolExecution = vi.fn();
    }),
    TimelineMessageRepository: vi.fn(function TimelineMessageRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    MemoryRepository: vi.fn(function MemoryRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    ProjectRepository: vi.fn(function ProjectRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    ArtifactContentStore: vi.fn(function ArtifactContentStore(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
    ArtifactService: vi.fn(function ArtifactService() {
      return {
        listByRun: vi.fn(),
        listBySession: vi.fn(),
        get: vi.fn(),
        getVersion: vi.fn(),
        createVersion: vi.fn(),
        updateStatus: vi.fn(),
        reference: vi.fn(),
      };
    }),
    createMemoryService: vi.fn(() => ({
      proposeCandidate: vi.fn(),
      listCandidates: vi.fn(),
      acceptCandidate: vi.fn(),
      rejectCandidate: vi.fn(),
      archiveCandidate: vi.fn(),
      listMemories: vi.fn(),
      getMemory: vi.fn(),
      updateMemory: vi.fn(),
      archiveMemory: vi.fn(),
      deleteMemory: vi.fn(),
      disableMemory: vi.fn(),
      enableMemory: vi.fn(),
      listSourceRefs: vi.fn(),
      listAccessLogs: vi.fn(),
      recallPreview: vi.fn(),
    })),
    MemoryRecallRuntimeService: vi.fn(function MemoryRecallRuntimeService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        recallForNewUserInput: vi.fn(() =>
          Promise.resolve({ status: 'skipped', reason: 'memory_disabled', memoryRecallSources: [] }),
        ),
      };
    }),
    MemoryRuntimeCaptureService: vi.fn(function MemoryRuntimeCaptureService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        evaluateRunCompletedCapture: vi.fn(() =>
          Promise.resolve({ status: 'skipped', reason: 'memory_disabled' }),
        ),
      };
    }),
    MemoryExtractionModelClientService: vi.fn(function MemoryExtractionModelClientService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        extractMemoryCandidates: vi.fn(() =>
          Promise.resolve({ ok: false, reason: 'not_configured' }),
        ),
      };
    }),
    PlanArtifactCompatibilityService: vi.fn(function PlanArtifactCompatibilityService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        syncImplementationPlanArtifact: vi.fn(),
      };
    }),
    createRecoveryService: vi.fn((_options?: unknown) => ({
      listRecoverableRuns: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
    })),
    createWorkspaceFilesService: vi.fn(() => ({
      listDirectory: vi.fn(),
    })),
    showOpenDialog: vi.fn(),
    getAllWindows: vi.fn(() => []),
  };
});

vi.mock('@megumi/desktop/main/config/env', () => ({
  loadEnvFile: mocks.loadEnvFile,
}));

vi.mock('@megumi/desktop/main/services/workspace/megumi-home.service', () => ({
  initializeElectronMegumiHomeSync: mocks.initializeElectronMegumiHomeSync,
}));

vi.mock('@megumi/desktop/main/ipc/register-ipc-handlers', () => ({
  registerAllHandlers: mocks.registerAllHandlers,
}));

vi.mock('@megumi/desktop/main/app/runtime-process-errors', () => ({
  registerRuntimeProcessErrorHandlers: mocks.registerRuntimeProcessErrorHandlers,
}));

vi.mock('@megumi/desktop/main/app/lifecycle', () => ({
  registerAppLifecycle: mocks.registerAppLifecycle,
}));

vi.mock('@megumi/desktop/main/app/create-window', () => ({
  createMainWindow: mocks.createMainWindow,
}));

vi.mock('@megumi/desktop/main/services/session/session-run.service', () => ({
  SessionRunService: mocks.SessionRunService,
}));

vi.mock('@megumi/desktop/main/services/runtime/model-step-provider.service', () => ({
  createModelStepProviderService: mocks.createModelStepProviderService,
}));

vi.mock('@megumi/coding-agent/settings', () => ({
  ProviderSettingsService: mocks.ProviderSettingsService,
  ProviderRuntimeService: mocks.ProviderRuntimeService,
}));

vi.mock('@megumi/desktop/main/services/settings/app-settings.service', () => ({
  createAppSettingsService: mocks.createAppSettingsService,
}));

vi.mock('@megumi/coding-agent/adapters/local/tools/tool.service', () => ({
  ToolService: mocks.ToolService,
  createDefaultToolService: mocks.createDefaultToolService,
}));

vi.mock('@megumi/desktop/main/services/runtime/recovery.service', () => ({
  createRecoveryService: mocks.createRecoveryService,
}));

vi.mock('@megumi/coding-agent/workspace', () => ({
  WorkspaceRestoreService: mocks.WorkspaceRestoreService,
  createWorkspaceChangeFooterProjectorService: vi.fn(() => ({ projectRunFooter: vi.fn() })),
  isWorkspaceChangeFooterProjectorPort: vi.fn(() => false),
}));

vi.mock('@megumi/desktop/main/services/workspace/workspace-files.service', () => ({
  createWorkspaceFilesService: mocks.createWorkspaceFilesService,
}));

vi.mock('@megumi/coding-agent/persistence', () => ({
  composeCodingAgentPersistence: mocks.composeCodingAgentPersistence,
}));

vi.mock('@megumi/coding-agent/composition', () => ({
  composeCodingAgentRuntime: mocks.composeCodingAgentRuntime,
  composeCodingAgentPersistence: mocks.composeCodingAgentPersistence,
}));

vi.mock('@megumi/desktop/main/services/security/permission-snapshot.service', () => ({
  PermissionSnapshotService: mocks.PermissionSnapshotService,
}));

vi.mock('@megumi/desktop/main/services/artifact/artifact-content-store.service', () => ({
  ArtifactContentStore: mocks.ArtifactContentStore,
}));

vi.mock('@megumi/coding-agent/artifacts', () => ({
  ArtifactService: mocks.ArtifactService,
  PlanArtifactCompatibilityService: mocks.PlanArtifactCompatibilityService,
}));

vi.mock('@megumi/coding-agent/memory', () => ({
  createMemoryService: mocks.createMemoryService,
  MemoryRecallRuntimeService: mocks.MemoryRecallRuntimeService,
  MemoryRuntimeCaptureService: mocks.MemoryRuntimeCaptureService,
  MemoryExtractionModelClientService: mocks.MemoryExtractionModelClientService,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mocks.getAllWindows,
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
  },
}));

describe('main runtime logger composition', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadEnvFile.mockClear();
    mocks.initializeElectronMegumiHomeSync.mockClear();
    mocks.registerAllHandlers.mockClear();
    mocks.registerRuntimeProcessErrorHandlers.mockClear();
    mocks.registerAppLifecycle.mockClear();
    mocks.createMainWindow.mockClear();
    mocks.SessionRunRepository.mockClear();
    mocks.PermissionSnapshotRepository.mockClear();
    mocks.PermissionSnapshotService.mockClear();
    mocks.SessionRunService.mockClear();
    mocks.createModelStepProviderService.mockClear();
    mocks.ProviderSettingsService.mockClear();
    mocks.ProviderRuntimeService.mockClear();
    mocks.createAppSettingsService.mockClear();
    mocks.ToolService.mockClear();
    mocks.createDefaultToolService.mockClear();
    mocks.composeCodingAgentPersistence.mockClear();
    mocks.RecoveryRepository.mockClear();
    mocks.WorkspaceChangeRepository.mockClear();
    mocks.WorkspaceRestoreService.mockClear();
    mocks.SessionActivePathRepository.mockClear();
    mocks.ArtifactRepository.mockClear();
    mocks.MemoryRepository.mockClear();
    mocks.ArtifactContentStore.mockClear();
    mocks.ArtifactService.mockClear();
    mocks.createMemoryService.mockClear();
    mocks.PlanArtifactCompatibilityService.mockClear();
    mocks.createRecoveryService.mockClear();
    mocks.createWorkspaceFilesService.mockClear();
    mocks.ProjectRepository.mockClear();
    mocks.showOpenDialog.mockClear();
    mocks.getAllWindows.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('uses permission snapshot naming for service composition', () => {
    const source = [
      'packages/coding-agent/composition/compose-coding-agent-persistence.ts',
      'packages/coding-agent/composition/compose-coding-agent-session-runtime.ts',
    ]
      .map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8'))
      .join('\n');

    expect(source).toContain('PermissionSnapshotRepository');
    expect(source).toContain('PermissionSnapshotService');
    expect(source).not.toContain('RunModeRepository');
    expect(source).not.toContain('RunModeService');
    expect(source).not.toContain('run-mode.service');
  });

  it('does not keep main run-mode compatibility shim files', () => {
    expect(existsSync(join(process.cwd(), 'apps/desktop/src/main/services/run-mode.service.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages/shared/run-mode-contracts.ts'))).toBe(false);
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const settingsService = mocks.createAppSettingsService.mock.results[0]?.value;
    const workspaceFilesService = mocks.createWorkspaceFilesService.mock.results[0]?.value;
    const projectService = mocks.codingAgentRuntime.projectService;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.createAppSettingsService).toHaveBeenCalledWith({
      settingsPath: `${mocks.homePath}/settings.json`,
    });
    expect(mocks.composeCodingAgentRuntime).toHaveBeenCalledWith(expect.objectContaining({
      homePaths: {
        homePath: mocks.homePath,
        sqlitePath: `${mocks.homePath}/sqlite`,
        settingsPath: `${mocks.homePath}/settings.json`,
      },
      runtimeLogger: processLogger,
      appSettingsProvider: settingsService,
      memorySettingsProvider: expect.objectContaining({
        isMemoryEnabled: expect.any(Function),
      }),
      permissionSettingsProvider: expect.any(Object),
      chatStreamEventSink: expect.objectContaining({
        publish: expect.any(Function),
        setWindow: expect.any(Function),
      }),
      directoryPicker: expect.objectContaining({
        chooseDirectory: expect.any(Function),
      }),
    }));
    const runtimeOptions = (mocks.composeCodingAgentRuntime.mock.calls as unknown as Array<[{
      memorySettingsProvider: { isMemoryEnabled(): boolean };
    }]>)[0]?.[0];
    expect(runtimeOptions.memorySettingsProvider.isMemoryEnabled()).toBe(false);
    expect(mocks.createWorkspaceFilesService).toHaveBeenCalledWith(expect.objectContaining({
      fileSystem: expect.any(Object),
      isWorkspaceRootAllowed: expect.any(Function),
      openPath: expect.any(Function),
    }));
    const [[workspaceFilesOptions]] = mocks.createWorkspaceFilesService.mock.calls as unknown as Array<[{
      isWorkspaceRootAllowed(root: string): boolean;
    }]>;
    expect(workspaceFilesOptions.isWorkspaceRootAllowed(process.cwd())).toBe(false);
    expect(workspaceFilesOptions.isWorkspaceRootAllowed('C:/all/work/study/megumi')).toBe(true);
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({
      logger: processLogger,
      providerService: expect.objectContaining({
        listProviderStatuses: expect.any(Function),
        getProviderSettings: expect.any(Function),
        updateProviderSettings: expect.any(Function),
        setProviderApiKey: expect.any(Function),
        deleteProviderApiKey: expect.any(Function),
      }),
      settingsService,
      sessionRunService: expect.objectContaining({
        createSession: expect.any(Function),
        listSessions: expect.any(Function),
        sendSessionMessage: expect.any(Function),
        createBranchDraft: expect.any(Function),
        cancelBranchDraft: expect.any(Function),
      }),
      agentRunService: expect.objectContaining({
        listRunsBySession: expect.any(Function),
        listRuntimeEventsByRun: expect.any(Function),
      }),
      runContextService: mocks.codingAgentRuntime.runContextService,
      planService: mocks.codingAgentRuntime.sessionRunService,
      toolService: mocks.codingAgentRuntime.toolService,
      recoveryService: mocks.codingAgentRuntime.recoveryService,
      artifactService: mocks.codingAgentRuntime.artifactService,
      memoryService: mocks.codingAgentRuntime.memoryService,
      projectService,
      workspaceFilesService,
    });

    processLogger.error('runtime_review_probe', {
      authorization: 'Bearer sk-runtime-secret',
    });

    const logText = readFileSync(join(mocks.logsPath, 'runtime.jsonl'), 'utf8');
    expect(logText).toContain('runtime_review_probe');
    expect(logText).not.toContain('sk-runtime-secret');
    expect(logText).not.toContain('Bearer sk-runtime-secret');
  });
});
