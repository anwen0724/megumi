// @vitest-environment node
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noopRuntimeLogger } from '@megumi/observability';

const mocks = vi.hoisted(() => {
  const homePath = `${process.cwd().replaceAll('\\', '/')}/.tmp/megumi-runtime-logger-review`;
  const logsPath = `${homePath}/logs`;
  const agentHost = {
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
      readSession: vi.fn(),
      readCommittedRun: vi.fn(),
      createDraft: vi.fn(),
      cancelDraft: vi.fn(),
    },
    permissions: {
      resolve: vi.fn(),
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
    createDatabase: vi.fn(() => ({ databaseId: 'agent-database' })),
    migrateDatabase: vi.fn(),
    agentHost,
    composeProduct: vi.fn(),
    createDesktopWorkspaceFileSystem: vi.fn(() => ({ kind: 'node-workspace-file-system' })),
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

vi.mock('@megumi/product', () => ({
  composeProduct: mocks.composeProduct,
}));

vi.mock('@megumi/desktop/main/adapters/desktop-workspace-file-system-adapter', () => ({
  createDesktopWorkspaceFileSystem: mocks.createDesktopWorkspaceFileSystem,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => 'test-version',
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
    mocks.createDesktopWorkspaceFileSystem.mockClear();
    mocks.composeProduct.mockImplementation(() => {
      const logger = noopRuntimeLogger;
      return {
        logger,
        host: mocks.agentHost,
        subscribeRuntimeEvents: () => ({ unsubscribe: () => undefined }),
        dispose: mocks.agentHost.dispose,
      };
    });
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
    const projectService = mocks.agentHost.workspace;
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
      settingsEnvironment: expect.objectContaining({ readVariable: expect.any(Function) }),
      workspaceFileSystem: expect.objectContaining({ kind: 'node-workspace-file-system' }),
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
      workspace: { host: mocks.agentHost },
      session: { host: mocks.agentHost },
      skill: { host: mocks.agentHost },
      settings: { host: mocks.agentHost },
      approval: { host: mocks.agentHost },
      observability: { host: mocks.agentHost },
    });

    expect(existsSync(join(mocks.logsPath, 'runtime.jsonl'))).toBe(false);
  });
});
