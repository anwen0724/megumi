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
    createDefaultAgentLifecycleService: vi.fn(() => ({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      startRun: vi.fn(),
      getPlanByRun: vi.fn(),
      updatePlanStatus: vi.fn(),
    })),
    createDefaultAgentContextService: vi.fn(() => ({
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    })),
    createDefaultAgentToolService: vi.fn(() => ({
      listDefinitions: vi.fn(),
      getToolCall: vi.fn(),
      resolveApproval: vi.fn(),
    })),
    createDatabase: vi.fn(() => ({ databaseId: 'recovery-database' })),
    migrateDatabase: vi.fn(),
    AgentRecoveryRepository: vi.fn(function AgentRecoveryRepository(
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
    ArtifactContentStore: vi.fn(function ArtifactContentStore(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
    AgentArtifactService: vi.fn(function AgentArtifactService() {
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
    createAgentRecoveryService: vi.fn(() => ({
      listRecoverableRuns: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
    })),
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

vi.mock('@megumi/desktop/main/services/agent-lifecycle.service', () => ({
  createDefaultAgentLifecycleService: mocks.createDefaultAgentLifecycleService,
}));

vi.mock('@megumi/desktop/main/services/agent-context.service', () => ({
  createDefaultAgentContextService: mocks.createDefaultAgentContextService,
}));

vi.mock('@megumi/desktop/main/services/agent-tool.service', () => ({
  createDefaultAgentToolService: mocks.createDefaultAgentToolService,
}));

vi.mock('@megumi/desktop/main/services/agent-recovery.service', () => ({
  createAgentRecoveryService: mocks.createAgentRecoveryService,
}));

vi.mock('@megumi/db/connection', () => ({
  createDatabase: mocks.createDatabase,
}));

vi.mock('@megumi/db/schema/migrations', () => ({
  migrateDatabase: mocks.migrateDatabase,
}));

vi.mock('@megumi/db/repos/agent-recovery.repo', () => ({
  AgentRecoveryRepository: mocks.AgentRecoveryRepository,
}));

vi.mock('@megumi/db/repos/artifact.repo', () => ({
  ArtifactRepository: mocks.ArtifactRepository,
}));

vi.mock('@megumi/desktop/main/services/artifact-content-store.service', () => ({
  ArtifactContentStore: mocks.ArtifactContentStore,
}));

vi.mock('@megumi/desktop/main/services/agent-artifact.service', () => ({
  AgentArtifactService: mocks.AgentArtifactService,
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
    mocks.createDefaultAgentLifecycleService.mockClear();
    mocks.createDefaultAgentContextService.mockClear();
    mocks.createDefaultAgentToolService.mockClear();
    mocks.createDatabase.mockClear();
    mocks.migrateDatabase.mockClear();
    mocks.AgentRecoveryRepository.mockClear();
    mocks.ArtifactRepository.mockClear();
    mocks.ArtifactContentStore.mockClear();
    mocks.AgentArtifactService.mockClear();
    mocks.createAgentRecoveryService.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const agentService = mocks.createDefaultAgentLifecycleService.mock.results[0]?.value;
    const agentContextService = mocks.createDefaultAgentContextService.mock.results[0]?.value;
    const agentToolService = mocks.createDefaultAgentToolService.mock.results[0]?.value;
    const agentRecoveryService = mocks.createAgentRecoveryService.mock.results[0]?.value;
    const agentArtifactService = mocks.AgentArtifactService.mock.results[0]?.value;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.createDefaultAgentContextService).toHaveBeenCalledWith(
      mocks.initializeElectronMegumiHomeSync.mock.results[0]?.value,
    );
    expect(mocks.createDefaultAgentLifecycleService).toHaveBeenCalledWith(
      mocks.initializeElectronMegumiHomeSync.mock.results[0]?.value,
      { contextService: agentContextService },
    );
    expect(mocks.createDefaultAgentToolService).toHaveBeenCalledWith(
      mocks.initializeElectronMegumiHomeSync.mock.results[0]?.value,
    );
    expect(mocks.migrateDatabase).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.AgentRecoveryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactContentStore).toHaveBeenCalledWith({
      artifactRoot: join(mocks.homePath, 'artifacts'),
    });
    expect(mocks.AgentArtifactService).toHaveBeenCalledWith({
      repository: expect.any(Object),
      contentStore: expect.any(Object),
    });
    expect(mocks.createAgentRecoveryService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      clock: expect.any(Function),
      ids: expect.objectContaining({
        resumeRequestId: expect.any(Function),
        cancelRequestId: expect.any(Function),
        retryRequestId: expect.any(Function),
      }),
      listRecoverableRuns: expect.any(Function),
    }));
    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({
      logger: processLogger,
      agentService,
      agentContextService,
      agentPlanService: agentService,
      agentToolService,
      agentRecoveryService,
      agentArtifactService,
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
