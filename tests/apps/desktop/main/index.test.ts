// @vitest-environment node
import { readFileSync, rmSync } from 'node:fs';
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
      configPath: `${homePath}/config.json`,
      configSchemaPath: `${homePath}/config.schema.json`,
      readmePath: `${homePath}/README.md`,
      versionPath: `${homePath}/version.json`,
      sqlitePath: `${homePath}/sqlite`,
      secretsPath: `${homePath}/secrets`,
      providerSecretsPath: `${homePath}/secrets/providers`,
      logsPath,
      cachePath: `${homePath}/cache`,
      tmpPath: `${homePath}/tmp`,
    })),
    registerAllHandlers: vi.fn(),
    registerRuntimeProcessErrorHandlers: vi.fn(),
    registerAppLifecycle: vi.fn(),
    createMainWindow: vi.fn(),
    SessionRunRepository: vi.fn(function SessionRunRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    RunModeRepository: vi.fn(function RunModeRepository(
      this: { database?: unknown },
      database: unknown,
    ) {
      this.database = database;
    }),
    RunModeService: vi.fn(function RunModeService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        createModeSnapshot: vi.fn(),
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
    getDefaultProviderService: vi.fn(() => ({
      listProviders: vi.fn(),
    })),
    createElectronSecretStoreService: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    })),
    MegumiHomeConfigService: vi.fn(function MegumiHomeConfigService(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
      return {
        getProviderApiKeyEnv: vi.fn(),
        getPlaintextProviderApiKey: vi.fn(),
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
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
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
    createRecoveryService: vi.fn(() => ({
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
  };
});

vi.mock('@megumi/desktop/main/config/env', () => ({
  loadEnvFile: mocks.loadEnvFile,
}));

vi.mock('@megumi/desktop/main/services/megumi-home.service', () => ({
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

vi.mock('@megumi/desktop/main/services/session-run.service', () => ({
  SessionRunService: mocks.SessionRunService,
}));

vi.mock('@megumi/desktop/main/services/model-step-provider.service', () => ({
  createModelStepProviderService: mocks.createModelStepProviderService,
}));

vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({
  getDefaultProviderService: mocks.getDefaultProviderService,
}));

vi.mock('@megumi/desktop/main/services/secret-store.service', () => ({
  createElectronSecretStoreService: mocks.createElectronSecretStoreService,
}));

vi.mock('@megumi/desktop/main/services/megumi-home-config.service', () => ({
  MegumiHomeConfigService: mocks.MegumiHomeConfigService,
}));

vi.mock('@megumi/desktop/main/services/provider-runtime.service', () => ({
  ProviderRuntimeService: mocks.ProviderRuntimeService,
}));

vi.mock('@megumi/desktop/main/services/run-context.service', () => ({
  createDefaultRunContextService: mocks.createDefaultRunContextService,
}));

vi.mock('@megumi/desktop/main/services/tool.service', () => ({
  ToolService: mocks.ToolService,
  createDefaultToolService: mocks.createDefaultToolService,
}));

vi.mock('@megumi/desktop/main/services/recovery.service', () => ({
  createRecoveryService: mocks.createRecoveryService,
}));

vi.mock('@megumi/desktop/main/services/workspace-files.service', () => ({
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

vi.mock('@megumi/db/repos/session-run.repo', () => ({
  SessionRunRepository: mocks.SessionRunRepository,
}));

vi.mock('@megumi/db/repos/run-mode.repo', () => ({
  RunModeRepository: mocks.RunModeRepository,
}));

vi.mock('@megumi/desktop/main/services/run-mode.service', () => ({
  RunModeService: mocks.RunModeService,
}));

vi.mock('@megumi/db/repos/artifact.repo', () => ({
  ArtifactRepository: mocks.ArtifactRepository,
}));

vi.mock('@megumi/db/repos/memory.repo', () => ({
  MemoryRepository: mocks.MemoryRepository,
}));

vi.mock('@megumi/desktop/main/services/artifact-content-store.service', () => ({
  ArtifactContentStore: mocks.ArtifactContentStore,
}));

vi.mock('@megumi/desktop/main/services/artifact.service', () => ({
  ArtifactService: mocks.ArtifactService,
}));

vi.mock('@megumi/desktop/main/services/memory.service', () => ({
  createMemoryService: mocks.createMemoryService,
}));

vi.mock('@megumi/desktop/main/services/plan-artifact-compatibility.service', () => ({
  PlanArtifactCompatibilityService: mocks.PlanArtifactCompatibilityService,
}));

vi.mock('@megumi/desktop/main/services/project.service', () => ({
  createProjectService: mocks.createProjectService,
}));

vi.mock('@megumi/db/repos/project.repo', () => ({
  ProjectRepository: mocks.ProjectRepository,
}));

vi.mock('electron', () => ({
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
    mocks.RunModeRepository.mockClear();
    mocks.RunModeService.mockClear();
    mocks.SessionRunService.mockClear();
    mocks.createModelStepProviderService.mockClear();
    mocks.getDefaultProviderService.mockClear();
    mocks.createElectronSecretStoreService.mockClear();
    mocks.MegumiHomeConfigService.mockClear();
    mocks.ProviderRuntimeService.mockClear();
    mocks.createDefaultRunContextService.mockClear();
    mocks.ToolService.mockClear();
    mocks.createDefaultToolService.mockClear();
    mocks.createDatabase.mockClear();
    mocks.migrateDatabase.mockClear();
    mocks.RecoveryRepository.mockClear();
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
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const sessionRunService = mocks.SessionRunService.mock.results[0]?.value;
    const runContextService = mocks.createDefaultRunContextService.mock.results[0]?.value;
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
    expect(mocks.migrateDatabase).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.SessionRunRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.RunModeRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.RecoveryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
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
    const runModeService = mocks.RunModeService.mock.results[0]?.value;
    expect(mocks.RunModeService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      planArtifactCompatibility,
    }));
    expect(mocks.getDefaultProviderService).toHaveBeenCalledTimes(1);
    expect(mocks.createElectronSecretStoreService).toHaveBeenCalledWith(mocks.homePath);
    expect(mocks.ProviderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.any(Object),
      secretStore: expect.any(Object),
      configCredentials: expect.objectContaining({
        getProviderApiKeyEnv: expect.any(Function),
        getPlaintextProviderApiKey: expect.any(Function),
      }),
    }));
    const modelStepProviderService = mocks.createModelStepProviderService.mock.results[0]?.value;
    expect(mocks.createModelStepProviderService).toHaveBeenCalledWith(
      mocks.ProviderRuntimeService.mock.results[0]?.value,
    );
    expect(mocks.SessionRunService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      runModeService,
      contextService: runContextService,
      modelStepProvider: modelStepProviderService,
    }));
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
      }),
      listRecoverableRuns: expect.any(Function),
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
    });
    const [[workspaceFilesOptions]] = mocks.createWorkspaceFilesService.mock.calls as unknown as Array<[{
      isWorkspaceRootAllowed(root: string): boolean;
    }]>;
    expect(workspaceFilesOptions.isWorkspaceRootAllowed(process.cwd())).toBe(true);
    expect(workspaceFilesOptions.isWorkspaceRootAllowed('C:/all/work/study/megumi')).toBe(true);
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({
      logger: processLogger,
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
