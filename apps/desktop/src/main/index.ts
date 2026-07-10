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
    registerAllHandlers: () => registerAllHandlers({
      logger: desktopMain.runtimeLogger,
      workspace: desktopMain.workspace,
      chat: desktopMain.chat,
      skill: desktopMain.skill,
      settings: desktopMain.settings,
      approval: desktopMain.approval,
      artifact: desktopMain.artifact,
    }),
    createWindow: () => {
      createMainWindow({
        devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
        rendererName: MAIN_WINDOW_VITE_NAME,
        dirname: __dirname,
      });
    },
    dispose: () => desktopMain.dispose(),
  });
}
