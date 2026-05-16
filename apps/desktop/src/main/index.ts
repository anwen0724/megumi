import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { AgentRecoveryRepository } from '@megumi/db/repos/agent-recovery.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { loadEnvFile } from './config/env';
import { initializeElectronMegumiHomeSync } from './services/megumi-home.service';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { createRuntimeJsonlLoggerForMegumiHome } from './services/runtime-logger.service';
import { createDefaultAgentLifecycleService } from './services/agent-lifecycle.service';
import { createDefaultAgentContextService } from './services/agent-context.service';
import { createDefaultAgentToolService } from './services/agent-tool.service';
import { createAgentRecoveryService } from './services/agent-recovery.service';

loadEnvFile();
const megumiHomePaths = initializeElectronMegumiHomeSync();
const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
const agentContextService = createDefaultAgentContextService(megumiHomePaths);
const agentService = createDefaultAgentLifecycleService(megumiHomePaths, { contextService: agentContextService });
const agentToolService = createDefaultAgentToolService(megumiHomePaths);
const agentRecoveryDatabase = createDatabase(path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3'));
migrateDatabase(agentRecoveryDatabase);
const agentRecoveryService = createAgentRecoveryService({
  repository: new AgentRecoveryRepository(agentRecoveryDatabase),
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
  }),
  createWindow: () => {
    createMainWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    });
  },
});
