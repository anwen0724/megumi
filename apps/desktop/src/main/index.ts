import { loadEnvFile } from './config/env';
import { initializeElectronMegumiHomeSync } from './services/megumi-home.service';
import { registerAllHandlers } from './ipc/register-handlers';
import { createMainWindow } from './app/create-window';
import { registerAppLifecycle } from './app/lifecycle';

loadEnvFile();

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

registerAppLifecycle({
  runMigrations: initializeElectronMegumiHomeSync,
  registerAllHandlers,
  createWindow: () => {
    createMainWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    });
  },
});
