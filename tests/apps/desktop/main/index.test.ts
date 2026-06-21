// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const homePath = `${process.cwd().replaceAll('\\', '/')}/.tmp/megumi-runtime-logger-review`;
  const logsPath = `${homePath}/logs`;
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
    createMainWindow: vi.fn(),
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
    createDefaultRunContextService: vi.fn(() => ({
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    })),
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
    createProjectService: vi.fn(() => ({
      listProjects: vi.fn(),
      useExistingProject: vi.fn(),
      openProject: vi.fn(),
      removeProject: vi.fn(),
      listAuthorizedWorkspaceRoots: vi.fn(() => ['C:/all/work/study/megumi']),
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

vi.mock('@megumi/desktop/main/services/project/megumi-home.service', () => ({
  initializeElectronMegumiHomeSync: mocks.initializeElectronMegumiHomeSync,
}));

vi.mock('@megumi/desktop/main/ipc/register-handlers', () => ({
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

vi.mock('@megumi/desktop/main/services/provider/provider-settings.service', () => ({
  ProviderSettingsService: mocks.ProviderSettingsService,
}));

vi.mock('@megumi/desktop/main/services/provider/provider-runtime.service', () => ({
  ProviderRuntimeService: mocks.ProviderRuntimeService,
}));

vi.mock('@megumi/desktop/main/services/runtime/run-context.service', () => ({
  createDefaultRunContextService: mocks.createDefaultRunContextService,
}));

vi.mock('@megumi/desktop/main/services/settings/app-settings.service', () => ({
  createAppSettingsService: mocks.createAppSettingsService,
}));

vi.mock('@megumi/desktop/main/services/tool/tool.service', () => ({
  ToolService: mocks.ToolService,
  createDefaultToolService: mocks.createDefaultToolService,
}));

vi.mock('@megumi/desktop/main/services/runtime/recovery.service', () => ({
  createRecoveryService: mocks.createRecoveryService,
}));

vi.mock('@megumi/desktop/main/services/workspace/workspace-restore.service', () => ({
  WorkspaceRestoreService: mocks.WorkspaceRestoreService,
}));

vi.mock('@megumi/desktop/main/services/workspace/workspace-files.service', () => ({
  createWorkspaceFilesService: mocks.createWorkspaceFilesService,
}));

vi.mock('@megumi/db/connection', () => ({
  createDatabase: mocks.createDatabase,
}));

vi.mock('@megumi/db/schema/migrations', () => ({
  migrateDatabase: mocks.migrateDatabase,
}));

vi.mock('@megumi/db/repos/recovery.repo', () => ({
  RecoveryRepository: mocks.RecoveryRepository,
}));

vi.mock('@megumi/db/repos/workspace-change.repo', () => ({
  WorkspaceChangeRepository: mocks.WorkspaceChangeRepository,
}));

vi.mock('@megumi/db/repos/session-active-path.repo', () => ({
  SessionActivePathRepository: mocks.SessionActivePathRepository,
}));

vi.mock('@megumi/db/repos/session-run.repo', () => ({
  SessionRunRepository: mocks.SessionRunRepository,
}));

vi.mock('@megumi/db/repos/permission-snapshot.repo', () => ({
  PermissionSnapshotRepository: mocks.PermissionSnapshotRepository,
}));

vi.mock('@megumi/desktop/main/services/security/permission-snapshot.service', () => ({
  PermissionSnapshotService: mocks.PermissionSnapshotService,
}));

vi.mock('@megumi/db/repos/artifact.repo', () => ({
  ArtifactRepository: mocks.ArtifactRepository,
}));

vi.mock('@megumi/db/repos/memory.repo', () => ({
  MemoryRepository: mocks.MemoryRepository,
}));

vi.mock('@megumi/desktop/main/services/artifact/artifact-content-store.service', () => ({
  ArtifactContentStore: mocks.ArtifactContentStore,
}));

vi.mock('@megumi/desktop/main/services/artifact/artifact.service', () => ({
  ArtifactService: mocks.ArtifactService,
}));

vi.mock('@megumi/desktop/main/services/memory/memory.service', () => ({
  createMemoryService: mocks.createMemoryService,
}));

vi.mock('@megumi/desktop/main/services/artifact/plan-artifact-compatibility.service', () => ({
  PlanArtifactCompatibilityService: mocks.PlanArtifactCompatibilityService,
}));

vi.mock('@megumi/desktop/main/services/project/project.service', () => ({
  createProjectService: mocks.createProjectService,
}));

vi.mock('@megumi/db/repos/project.repo', () => ({
  ProjectRepository: mocks.ProjectRepository,
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
    mocks.createDefaultRunContextService.mockClear();
    mocks.createAppSettingsService.mockClear();
    mocks.ToolService.mockClear();
    mocks.createDefaultToolService.mockClear();
    mocks.createDatabase.mockClear();
    mocks.migrateDatabase.mockClear();
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
    mocks.createProjectService.mockClear();
    mocks.showOpenDialog.mockClear();
    mocks.getAllWindows.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('uses permission snapshot naming for service composition', () => {
    const source = [
      'apps/desktop/src/main/composition/compose-database.ts',
      'apps/desktop/src/main/composition/compose-session-runtime.ts',
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
    const sessionRunService = mocks.SessionRunService.mock.results[0]?.value;
    const runContextService = mocks.createDefaultRunContextService.mock.results[0]?.value;
    const settingsService = mocks.createAppSettingsService.mock.results[0]?.value;
    const providerService = mocks.ProviderSettingsService.mock.results[0]?.value;
    const toolService = mocks.ToolService.mock.results[0]?.value;
    const recoveryService = mocks.createRecoveryService.mock.results[0]?.value;
    const artifactService = mocks.ArtifactService.mock.results[0]?.value;
    const memoryService = mocks.createMemoryService.mock.results[0]?.value;
    const workspaceFilesService = mocks.createWorkspaceFilesService.mock.results[0]?.value;
    const projectService = mocks.createProjectService.mock.results[0]?.value;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.createDefaultRunContextService).toHaveBeenCalledWith(
      mocks.initializeElectronMegumiHomeSync.mock.results[0]?.value,
    );
    expect(mocks.createAppSettingsService).toHaveBeenCalledWith({
      settingsPath: `${mocks.homePath}/settings.json`,
    });
    expect(mocks.migrateDatabase).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.SessionRunRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.SessionActivePathRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.PermissionSnapshotRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.RecoveryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.WorkspaceChangeRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.MemoryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ProjectRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactContentStore).toHaveBeenCalledWith({
      artifactRoot: join(mocks.homePath, 'artifacts'),
    });
    const planArtifactCompatibility = mocks.PlanArtifactCompatibilityService.mock.results[0]?.value;
    expect(mocks.PlanArtifactCompatibilityService).toHaveBeenCalledWith({
      repository: expect.any(Object),
    });
    const permissionSnapshotService = mocks.PermissionSnapshotService.mock.results[0]?.value;
    expect(mocks.PermissionSnapshotService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      planArtifactCompatibility,
    }));
    expect(mocks.ProviderSettingsService).toHaveBeenCalledWith({
      settings: settingsService,
    });
    expect(mocks.ProviderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({
      settings: mocks.ProviderSettingsService.mock.results[0]?.value,
    }));
    const modelStepProviderService = mocks.createModelStepProviderService.mock.results[0]?.value;
    expect(mocks.createModelStepProviderService).toHaveBeenCalledWith(
      mocks.ProviderRuntimeService.mock.results[0]?.value,
    );
    const activePathRepository = mocks.SessionActivePathRepository.mock.results[0]?.value;
    expect(mocks.SessionRunService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      activePathRepository,
      permissionSnapshotService,
      contextService: runContextService,
      modelStepProvider: modelStepProviderService,
      chatStreamEventSink: expect.objectContaining({
        publish: expect.any(Function),
      }),
      memorySettingsProvider: expect.objectContaining({
        isMemoryEnabled: expect.any(Function),
      }),
    }));
    const sessionRunOptions = mocks.SessionRunService.mock.calls[0]?.[0] as {
      memorySettingsProvider: { isMemoryEnabled(): boolean };
    };
    expect(sessionRunOptions.memorySettingsProvider.isMemoryEnabled()).toBe(false);
    expect(mocks.ToolService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      registry: expect.any(Object),
      resumeApproval: expect.any(Function),
    }));
    expect(mocks.ArtifactService).toHaveBeenCalledWith({
      repository: expect.any(Object),
      contentStore: expect.any(Object),
    });
    expect(mocks.createMemoryService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      now: expect.any(Function),
      createId: expect.any(Function),
      emitRuntimeEvent: expect.any(Function),
    }));
    expect(mocks.createRecoveryService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      clock: expect.any(Function),
      ids: expect.objectContaining({
        resumeRequestId: expect.any(Function),
        cancelRequestId: expect.any(Function),
        retryRequestId: expect.any(Function),
        eventId: expect.any(Function),
        interruptedMarkerId: expect.any(Function),
      }),
      workspaceChanges: expect.objectContaining({
        listChangeSummariesByRun: expect.any(Function),
      }),
      workspaceRestore: expect.objectContaining({
        restoreChangeSet: expect.any(Function),
      }),
      appendRuntimeEvent: expect.any(Function),
      nextRuntimeSequence: expect.any(Function),
    }));
    expect(mocks.createRecoveryService.mock.calls[0]?.[0]).not.toHaveProperty('listRecoverableRuns');
    const recoveryOptions = mocks.createRecoveryService.mock.calls[0]?.[0] as {
      workspaceRestore: {
        restoreChangeSet(input: { changeSetId: string; requestedBy: 'user' }): Promise<unknown>;
      };
    };
    await recoveryOptions.workspaceRestore.restoreChangeSet({
      changeSetId: 'workspace-change-set-1',
      requestedBy: 'user',
    });
    expect(mocks.WorkspaceChangeRepository.mock.instances[0]?.getChangeSet).toHaveBeenCalledWith(
      'workspace-change-set-1',
    );
    expect(mocks.SessionRunRepository.mock.instances[0]?.getRun).toHaveBeenCalledWith('run_123');
    expect(mocks.SessionRunRepository.mock.instances[0]?.getSession).toHaveBeenCalledWith('session_123');
    expect(mocks.WorkspaceRestoreService).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: 'C:/work/project',
      repository: mocks.WorkspaceChangeRepository.mock.instances[0],
      fileSystem: expect.objectContaining({
        readFile: expect.any(Function),
        writeFile: expect.any(Function),
        remove: expect.any(Function),
      }),
      ids: expect.objectContaining({
        restoreRequestId: expect.any(Function),
        restoreResultId: expect.any(Function),
        restoreFileResultId: expect.any(Function),
      }),
    }));
    expect(mocks.createProjectService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      chooseDirectory: expect.any(Function),
      fileSystem: expect.objectContaining({
        stat: expect.any(Function),
      }),
    }));
    expect(mocks.createWorkspaceFilesService).toHaveBeenCalledWith({
      isWorkspaceRootAllowed: expect.any(Function),
      openPath: expect.any(Function),
    });
    const [[workspaceFilesOptions]] = mocks.createWorkspaceFilesService.mock.calls as unknown as Array<[{
      isWorkspaceRootAllowed(root: string): boolean;
    }]>;
    expect(workspaceFilesOptions.isWorkspaceRootAllowed(process.cwd())).toBe(true);
    expect(workspaceFilesOptions.isWorkspaceRootAllowed('C:/all/work/study/megumi')).toBe(true);
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({
      logger: processLogger,
      providerService,
      settingsService,
      sessionRunService,
      runContextService,
      planService: sessionRunService,
      toolService,
      recoveryService,
      artifactService,
      memoryService,
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


