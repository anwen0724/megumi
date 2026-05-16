import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import { AgentRecoveryRepository } from '@megumi/db/repos/agent-recovery.repo';
import { AgentRunModeRepository } from '@megumi/db/repos/agent-run-mode.repo';
import { ArtifactRepository } from '@megumi/db/repos/artifact.repo';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { loadEnvFile } from './config/env';
import { initializeElectronMegumiHomeSync } from './services/megumi-home.service';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { createRuntimeJsonlLoggerForMegumiHome } from './services/runtime-logger.service';
import { AgentLifecycleService } from './services/agent-lifecycle.service';
import { AgentRunModeService } from './services/agent-run-mode.service';
import { createDefaultAgentContextService } from './services/agent-context.service';
import { createDefaultAgentToolService } from './services/agent-tool.service';
import { createAgentRecoveryService } from './services/agent-recovery.service';
import { ArtifactContentStore } from './services/artifact-content-store.service';
import { AgentArtifactService } from './services/agent-artifact.service';
import { createAgentMemoryService } from './services/agent-memory.service';
import { PlanArtifactCompatibilityService } from './services/plan-artifact-compatibility.service';

loadEnvFile();
const megumiHomePaths = initializeElectronMegumiHomeSync();
const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
const agentContextService = createDefaultAgentContextService(megumiHomePaths);
const agentToolService = createDefaultAgentToolService(megumiHomePaths);
const database = createDatabase(path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3'));
migrateDatabase(database);
const artifactRepository = new ArtifactRepository(database);
const memoryRepository = new MemoryRepository(database);
const planArtifactCompatibility = new PlanArtifactCompatibilityService({
  repository: artifactRepository,
});
const agentRunModeService = new AgentRunModeService({
  repository: new AgentRunModeRepository(database),
  planArtifactCompatibility,
});
const agentService = new AgentLifecycleService({
  repository: new AgentLifecycleRepository(database),
  runModeService: agentRunModeService,
  contextService: agentContextService,
});
const artifactContentStore = new ArtifactContentStore({
  artifactRoot: path.join(megumiHomePaths.homePath, 'artifacts'),
});
const agentArtifactService = new AgentArtifactService({
  repository: artifactRepository,
  contentStore: artifactContentStore,
});
const agentMemoryService = createAgentMemoryService({
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
const agentRecoveryService = createAgentRecoveryService({
  repository: new AgentRecoveryRepository(database),
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
    agentService,
    agentContextService,
    agentPlanService: agentService,
    agentToolService,
    agentRecoveryService,
    agentArtifactService,
    agentMemoryService,
  }),
  createWindow: () => {
    createMainWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    });
  },
});
