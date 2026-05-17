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
    AgentRunModeService: vi.fn(function AgentRunModeService(
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
    createAgentMemoryService: vi.fn(() => ({
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

vi.mock('@megumi/db/repos/recovery.repo', () => ({
  RecoveryRepository: mocks.RecoveryRepository,
}));

vi.mock('@megumi/db/repos/session-run.repo', () => ({
  SessionRunRepository: mocks.SessionRunRepository,
}));

vi.mock('@megumi/db/repos/run-mode.repo', () => ({
  RunModeRepository: mocks.RunModeRepository,
}));

vi.mock('@megumi/desktop/main/services/agent-run-mode.service', () => ({
  AgentRunModeService: mocks.AgentRunModeService,
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

vi.mock('@megumi/desktop/main/services/agent-artifact.service', () => ({
  AgentArtifactService: mocks.AgentArtifactService,
}));

vi.mock('@megumi/desktop/main/services/agent-memory.service', () => ({
  createAgentMemoryService: mocks.createAgentMemoryService,
}));

vi.mock('@megumi/desktop/main/services/plan-artifact-compatibility.service', () => ({
  PlanArtifactCompatibilityService: mocks.PlanArtifactCompatibilityService,
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
    mocks.AgentRunModeService.mockClear();
    mocks.SessionRunService.mockClear();
    mocks.createModelStepProviderService.mockClear();
    mocks.getDefaultProviderService.mockClear();
    mocks.createElectronSecretStoreService.mockClear();
    mocks.MegumiHomeConfigService.mockClear();
    mocks.ProviderRuntimeService.mockClear();
    mocks.createDefaultAgentContextService.mockClear();
    mocks.createDefaultAgentToolService.mockClear();
    mocks.createDatabase.mockClear();
    mocks.migrateDatabase.mockClear();
    mocks.RecoveryRepository.mockClear();
    mocks.ArtifactRepository.mockClear();
    mocks.MemoryRepository.mockClear();
    mocks.ArtifactContentStore.mockClear();
    mocks.AgentArtifactService.mockClear();
    mocks.createAgentMemoryService.mockClear();
    mocks.PlanArtifactCompatibilityService.mockClear();
    mocks.createAgentRecoveryService.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    const sessionRunService = mocks.SessionRunService.mock.results[0]?.value;
    const agentContextService = mocks.createDefaultAgentContextService.mock.results[0]?.value;
    const agentToolService = mocks.createDefaultAgentToolService.mock.results[0]?.value;
    const agentRecoveryService = mocks.createAgentRecoveryService.mock.results[0]?.value;
    const agentArtifactService = mocks.AgentArtifactService.mock.results[0]?.value;
    const agentMemoryService = mocks.createAgentMemoryService.mock.results[0]?.value;
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
    expect(mocks.createDefaultAgentToolService).toHaveBeenCalledWith(
      mocks.initializeElectronMegumiHomeSync.mock.results[0]?.value,
    );
    expect(mocks.migrateDatabase).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.SessionRunRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.RunModeRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.RecoveryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.MemoryRepository).toHaveBeenCalledWith(mocks.createDatabase.mock.results[0]?.value);
    expect(mocks.ArtifactContentStore).toHaveBeenCalledWith({
      artifactRoot: join(mocks.homePath, 'artifacts'),
    });
    const planArtifactCompatibility = mocks.PlanArtifactCompatibilityService.mock.results[0]?.value;
    expect(mocks.PlanArtifactCompatibilityService).toHaveBeenCalledWith({
      repository: expect.any(Object),
    });
    const runModeService = mocks.AgentRunModeService.mock.results[0]?.value;
    expect(mocks.AgentRunModeService).toHaveBeenCalledWith(expect.objectContaining({
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
      contextService: agentContextService,
      modelStepProvider: modelStepProviderService,
    }));
    expect(mocks.AgentArtifactService).toHaveBeenCalledWith({
      repository: expect.any(Object),
      contentStore: expect.any(Object),
    });
    expect(mocks.createAgentMemoryService).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.any(Object),
      now: expect.any(Function),
      createId: expect.any(Function),
      emitRuntimeEvent: expect.any(Function),
    }));
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
      sessionRunService,
      agentService: sessionRunService,
      agentContextService,
      agentPlanService: sessionRunService,
      agentToolService,
      agentRecoveryService,
      agentArtifactService,
      agentMemoryService,
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
