import { loadEnvFile } from './config/env';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { composeDesktopMain } from './composition/desktop-main-composition';

loadEnvFile();
const desktopMain = composeDesktopMain();

registerRuntimeProcessErrorHandlers({ logger: desktopMain.runtimeLogger });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

registerAppLifecycle({
  runMigrations: () => desktopMain.megumiHomePaths,
  registerAllHandlers: () => registerAllHandlers({
    logger: desktopMain.runtimeLogger,
    sessionRunService: desktopMain.sessionRunService,
    runContextService: desktopMain.runContextService,
    planService: desktopMain.sessionRunService,
    toolService: desktopMain.toolService,
    recoveryService: desktopMain.recoveryService,
    artifactService: desktopMain.artifactService,
    memoryService: desktopMain.memoryService,
    settingsService: desktopMain.appSettingsService,
    projectService: desktopMain.projectService,
    workspaceFilesService: desktopMain.workspaceFilesService,
  }),
  createWindow: () => {
    createMainWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    });
  },
});
