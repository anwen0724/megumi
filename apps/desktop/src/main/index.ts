import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RecoveryRepository } from '@megumi/db/repos/recovery.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { ArtifactRepository } from '@megumi/db/repos/artifact.repo';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import { loadEnvFile } from './config/env';
import { initializeElectronMegumiHomeSync } from './services/megumi-home.service';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { createRuntimeJsonlLoggerForMegumiHome } from './services/runtime-logger.service';
import { SessionRunService, type SessionRunToolRuntimeFactory } from './services/session-run.service';
import { createModelStepProviderService } from './services/model-step-provider.service';
import { MegumiHomeConfigService } from './services/megumi-home-config.service';
import { ProviderRuntimeService } from './services/provider-runtime.service';
import { createElectronSecretStoreService } from './services/secret-store.service';
import { RunModeService } from './services/run-mode.service';
import { createDefaultRunContextService } from './services/run-context.service';
import { ToolService } from './services/tool.service';
import { createToolUseHandlerService } from './services/tool-use-handler.service';
import { createProjectToolExecutor } from './services/project-tool-executor.service';
import { createPermissionSettingsService } from './services/permission-settings.service';
import { createRecoveryService } from './services/recovery.service';
import { ArtifactContentStore } from './services/artifact-content-store.service';
import { ArtifactService } from './services/artifact.service';
import { createMemoryService } from './services/memory.service';
import { PlanArtifactCompatibilityService } from './services/plan-artifact-compatibility.service';
import fs from 'fs-extra';
import { dialog } from 'electron';
import { ProjectRepository } from '@megumi/db/repos/project.repo';
import { createProjectService } from './services/project.service';
import { createWorkspaceFilesService } from './services/workspace-files.service';
import { createWorkspaceRootAuthorizer } from './services/workspace-root-authorization.service';
import { getDefaultProviderService } from './ipc/handlers/provider.handler';

loadEnvFile();
const megumiHomePaths = initializeElectronMegumiHomeSync();
const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
const runContextService = createDefaultRunContextService(megumiHomePaths);
const database = createDatabase(path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3'));
migrateDatabase(database);
const toolRepository = new ToolRepository(database);
const toolRegistry = createBuiltInToolRegistry();
const permissionSettingsService = createPermissionSettingsService({
  userConfigPath: megumiHomePaths.configPath,
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
const runModeService = new RunModeService({
  repository: new RunModeRepository(database),
  planArtifactCompatibility,
});
const providerSettingsService = getDefaultProviderService();
const secretStore = createElectronSecretStoreService(megumiHomePaths.homePath);
const configCredentials = {
  async getProviderApiKeyEnv(providerId: ProviderId) {
    return new MegumiHomeConfigService({ configPath: megumiHomePaths.configPath }).getProviderApiKeyEnv(providerId);
  },
  async getPlaintextProviderApiKey(providerId: ProviderId) {
    return new MegumiHomeConfigService({ configPath: megumiHomePaths.configPath }).getPlaintextProviderApiKey(providerId);
  },
};
const providerRuntimeService = new ProviderRuntimeService({
  settings: providerSettingsService,
  secretStore,
  configCredentials,
});
const modelStepProviderService = createModelStepProviderService(providerRuntimeService);
const toolRuntimeFactory: SessionRunToolRuntimeFactory = {
  async create({ projectRoot, permissionMode }) {
    return createToolUseHandlerService({
      registry: toolRegistry,
      repository: toolRepository,
      permissionMode,
      projectRoot,
      settings: await permissionSettingsService.loadForProject(projectRoot),
      projectExecutor: createProjectToolExecutor({ projectRoot }),
    });
  },
};
const sessionRunService = new SessionRunService({
  repository: new SessionRunRepository(database),
  runModeService: runModeService,
  contextService: runContextService,
  modelStepProvider: modelStepProviderService,
  toolRuntimeFactory,
  toolDefinitionProvider: toolRegistry,
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
const recoveryService = createRecoveryService({
  repository: new RecoveryRepository(database),
  clock: () => new Date(),
  ids: {
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
  },
  listRecoverableRuns: () => [],
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
