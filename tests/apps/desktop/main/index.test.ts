// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const homePath = `${process.cwd().replaceAll('\\', '/')}/.tmp/megumi-runtime-logger-review`;
  const logsPath = `${homePath}/logs`;
  const codingAgentHost = {
    input: {
      send: vi.fn(),
      cancel: vi.fn(),
    },
    workspace: {
      listProjects: vi.fn(),
      useExistingProject: vi.fn(),
      openProject: vi.fn(),
      removeProject: vi.fn(),
      listAuthorizedWorkspaceRoots: vi.fn(() => ['C:/all/work/study/megumi']),
    },
    session: {
      create: vi.fn(),
      list: vi.fn(),
      listMessages: vi.fn(),
      listTimeline: vi.fn(),
      listRuns: vi.fn(),
      createDraft: vi.fn(),
      cancelDraft: vi.fn(),
    },
    permissions: {
      resolve: vi.fn(),
    },
    artifacts: {
      listByRun: vi.fn(),
      listBySession: vi.fn(),
      get: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
      plan: {
        getByRun: vi.fn(),
        updateStatus: vi.fn(),
      },
    },
    settings: {
      get: vi.fn(),
      update: vi.fn(),
      provider: {
        list: vi.fn(),
        update: vi.fn(),
        setApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
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
    createDatabase: vi.fn(() => ({ databaseId: 'coding-agent-database' })),
    migrateDatabase: vi.fn(),
    codingAgentRuntime: codingAgentHost,
    codingAgentHost,
    composeCodingAgentHostInterface: vi.fn(() => codingAgentHost),
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
    createWorkspaceFilesService: vi.fn(() => ({
      listDirectory: vi.fn(),
    })),
    showOpenDialog: vi.fn(),
    getAllWindows: vi.fn(() => []),
    quit: vi.fn(),
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

vi.mock('@megumi/coding-agent/workspace', () => ({
  createWorkspaceChangeFooterProjectorService: vi.fn(() => ({ projectRunFooter: vi.fn() })),
  isWorkspaceChangeFooterProjectorPort: vi.fn(() => false),
}));

vi.mock('@megumi/desktop/main/services/workspace/workspace-files.service', () => ({
  createWorkspaceFilesService: mocks.createWorkspaceFilesService,
}));

vi.mock('@megumi/coding-agent/composition', () => ({
  composeCodingAgentHostInterface: mocks.composeCodingAgentHostInterface,
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
  app: {
    quit: mocks.quit,
  },
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
    mocks.composeCodingAgentHostInterface.mockClear();
    mocks.ArtifactRepository.mockClear();
    mocks.MemoryRepository.mockClear();
    mocks.ArtifactContentStore.mockClear();
    mocks.ArtifactService.mockClear();
    mocks.createMemoryService.mockClear();
    mocks.PlanArtifactCompatibilityService.mockClear();
    mocks.createWorkspaceFilesService.mockClear();
    mocks.showOpenDialog.mockClear();
    mocks.getAllWindows.mockClear();
    mocks.quit.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('does not keep main run-mode compatibility shim files', () => {
    expect(existsSync(join(process.cwd(), 'apps/desktop/src/main/services/run-mode.service.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages', 'shared', 'run-mode-contracts.ts'))).toBe(false);
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const workspaceFilesService = mocks.createWorkspaceFilesService.mock.results[0]?.value;
    const projectService = mocks.codingAgentHost.workspace;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.composeCodingAgentHostInterface).toHaveBeenCalledWith(expect.objectContaining({
      homePaths: {
        homePath: mocks.homePath,
        sqlitePath: `${mocks.homePath}/sqlite`,
        settingsPath: `${mocks.homePath}/settings.json`,
      },
      runtimeLogger: processLogger,
      directoryPicker: expect.objectContaining({
        chooseDirectory: expect.any(Function),
      }),
    }));
    expect(mocks.composeCodingAgentHostInterface).not.toHaveBeenCalledWith(expect.objectContaining({
      runtimeEventSink: expect.anything(),
    }));
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
      workspace: { host: mocks.codingAgentHost, workspaceFilesService },
      chat: { host: mocks.codingAgentHost },
      settings: { host: mocks.codingAgentHost },
      approval: { host: mocks.codingAgentHost },
      artifact: mocks.codingAgentHost.artifacts,
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
