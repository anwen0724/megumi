// @vitest-environment node
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noopRuntimeLogger } from '@megumi/product/logging';

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
      listAuthorizedWorkspaceRoots: vi.fn(() => ['C:/workspaces/megumi']),
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
    createElectronMegumiHomeSyncOptions: vi.fn(() => ({
      env: {},
      homedir: () => homePath,
      resourceLocator: { builtInSkillsPath: `${homePath}/resources/skills` },
    })),
    megumiHomePaths: {
      homePath,
      settingsPath: `${homePath}/settings.json`,
      settingsSchemaPath: `${homePath}/settings.schema.json`,
      readmePath: `${homePath}/README.md`,
      versionPath: `${homePath}/version.json`,
      sqlitePath: `${homePath}/sqlite`,
      logsPath,
      cachePath: `${homePath}/cache`,
      tmpPath: `${homePath}/tmp`,
    },
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
    codingAgentHost,
    composeProduct: vi.fn(),
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
    showOpenDialog: vi.fn(),
    getAllWindows: vi.fn(() => []),
    quit: vi.fn(),
  };
});

vi.mock('@megumi/desktop/main/config/env', () => ({
  loadEnvFile: mocks.loadEnvFile,
}));

vi.mock('@megumi/desktop/main/adapters/electron-home-adapter', () => ({
  createElectronMegumiHomeSyncOptions: mocks.createElectronMegumiHomeSyncOptions,
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

vi.mock('@megumi/product/composition', () => ({
  composeProduct: mocks.composeProduct,
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
    mocks.createElectronMegumiHomeSyncOptions.mockClear();
    mocks.registerAllHandlers.mockClear();
    mocks.registerRuntimeProcessErrorHandlers.mockClear();
    mocks.registerAppLifecycle.mockClear();
    mocks.createMainWindow.mockClear();
    mocks.composeProduct.mockReset();
    mocks.composeProduct.mockImplementation(() => {
      const logger = noopRuntimeLogger;
      return {
        homePaths: mocks.megumiHomePaths,
        logger,
        host: mocks.codingAgentHost,
        dispose: mocks.codingAgentHost.dispose,
      };
    });
    mocks.ArtifactRepository.mockClear();
    mocks.MemoryRepository.mockClear();
    mocks.ArtifactContentStore.mockClear();
    mocks.ArtifactService.mockClear();
    mocks.createMemoryService.mockClear();
    mocks.PlanArtifactCompatibilityService.mockClear();
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

  it('wires unified Observability storage into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const projectService = mocks.codingAgentHost.workspace;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.composeProduct).toHaveBeenCalledWith(expect.objectContaining({
      home: expect.objectContaining({
        resourceLocator: expect.any(Object),
      }),
      observabilityStorage: expect.objectContaining({ appendText: expect.any(Function), readText: expect.any(Function) }),
      diagnosticBundleSave: expect.objectContaining({ save: expect.any(Function) }),
      productEnvironment: expect.objectContaining({ platform: expect.any(String), arch: expect.any(String) }),
      directoryPicker: expect.objectContaining({
        chooseDirectory: expect.any(Function),
      }),
      fileOpen: expect.objectContaining({
        openPath: expect.any(Function),
      }),
    }));
    const deletedRuntimeEventSinkOption = ['runtime', 'Event', 'Sink'].join('');
    expect(mocks.composeProduct).not.toHaveBeenCalledWith(expect.objectContaining({
      [deletedRuntimeEventSinkOption]: expect.anything(),
    }));
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({
      logger: processLogger,
      workspace: { host: mocks.codingAgentHost },
      chat: { host: mocks.codingAgentHost },
      skill: { host: mocks.codingAgentHost },
      settings: { host: mocks.codingAgentHost },
      approval: { host: mocks.codingAgentHost },
      artifact: mocks.codingAgentHost.artifacts,
      observability: { host: mocks.codingAgentHost },
    });

    expect(existsSync(join(mocks.logsPath, 'runtime.jsonl'))).toBe(false);
  });
});
