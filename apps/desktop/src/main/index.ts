import { app } from 'electron';
import { loadEnvFile } from './config/env';
import { registerAllHandlers } from './ipc/register-ipc-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { shouldQuitForSquirrelStartup } from './app/squirrel-startup';
import { composeDesktopMain } from './shell-composition/desktop-main-composition';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

if (shouldQuitForSquirrelStartup()) {
  app.quit();
} else {
  loadEnvFile();
  const desktopMain = composeDesktopMain();

  registerRuntimeProcessErrorHandlers({ logger: desktopMain.runtimeLogger });

  registerAppLifecycle({
    runMigrations: () => desktopMain.megumiHomePaths,
    registerAllHandlers: () => registerAllHandlers({
      logger: desktopMain.runtimeLogger,
      providerService: desktopMain.providerService,
      sessionHandlers: desktopMain.sessionHandlers,
      planService: desktopMain.planService,
      permissionsService: desktopMain.permissionsService,
      artifactService: desktopMain.artifactService,
      settingsService: desktopMain.settingsService,
      projectService: desktopMain.projectService,
      workspaceFilesService: desktopMain.workspaceFilesService,
    }),
    createWindow: () => {
      const window = createMainWindow({
        devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
        rendererName: MAIN_WINDOW_VITE_NAME,
        dirname: __dirname,
      });
      desktopMain.chatStreamBroadcaster.setWindow(window);
      window.on('closed', () => {
        desktopMain.chatStreamBroadcaster.setWindow(undefined);
      });
    },
    dispose: () => desktopMain.dispose(),
  });
}
