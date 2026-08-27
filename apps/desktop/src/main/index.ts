/*
 * Boots the Electron Desktop Host and stops before Product startup when composition is unsafe.
 */
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { loadEnvFile } from './config/env';
import { registerAllHandlers } from './ipc/register-ipc-handlers';
import { IPC_CHANNELS } from './ipc/channels';
import { createMainWindow } from './app/create-window';
import { createCharacterWindow } from './app/create-character-window';
import { createCharacterWindowController } from './app/character-window-controller';
import { createMegumiTray, type MegumiTray } from './app/create-tray';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { shouldQuitForSquirrelStartup } from './app/squirrel-startup';
import { composeDesktopMain } from './shell-composition/desktop-main-composition';
import type { CharacterWindowController } from './app/character-window-controller';
import { createFileCharacterWindowStateStore } from './adapters/file-character-window-state-store';
import { showDesktopBootstrapFailure } from './app/bootstrap-failure';
import { composeApplicationUpdate } from './application-update/application-update-composition';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

if (shouldQuitForSquirrelStartup()) {
  app.quit();
} else {
  loadEnvFile();
  try {
    startDesktop(composeDesktopMain());
  } catch (error) {
    void stopAfterBootstrapFailure(error);
  }
}

function startDesktop(desktopMain: ReturnType<typeof composeDesktopMain>): void {
  let prepareToQuit: () => Promise<void> = async () => {
    throw new Error('Desktop lifecycle is not ready for update installation.');
  };
  const applicationUpdate = composeApplicationUpdate({
    megumiHomePath: desktopMain.homePath,
    logger: desktopMain.runtimeLogger,
    prepareToQuit: () => prepareToQuit(),
  });
  const applicationUpdateSubscription = applicationUpdate.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.applicationUpdate.snapshotChanged, snapshot);
    }
  });
  let character: CharacterWindowController | undefined;
  let mainWindow: BrowserWindow | undefined;
  let tray: MegumiTray | undefined;
  let quitApplication = () => app.quit();
  let showMainWindow = () => {
    mainWindow?.show();
    mainWindow?.focus();
  };
  character = createCharacterWindowController({
    createWindow: () => createCharacterWindow({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      rendererName: MAIN_WINDOW_VITE_NAME,
      dirname: __dirname,
    }),
    endVoiceSession: () => desktopMain.voice.host.voice.endSession(),
    showMainWindow: () => showMainWindow(),
    openSettings: () => {
      showMainWindow();
      mainWindow?.webContents.send(IPC_CHANNELS.character.settingsRequested);
    },
    stateStore: createFileCharacterWindowStateStore({
      filePath: path.join(desktopMain.homePath, 'desktop', 'character-window.json'),
    }),
  });
  const characterSubscription = character.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.character.snapshotChanged, snapshot);
    }
  });

  registerRuntimeProcessErrorHandlers({ logger: desktopMain.runtimeLogger });

  const lifecycle = registerAppLifecycle({
    start: () => {
      applicationUpdate.start();
      void desktopMain.start().catch((error: unknown) => {
        desktopMain.runtimeLogger.warn('product_background_start_failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
    },
    registerAllHandlers: () => {
      registerAllHandlers({
        logger: desktopMain.runtimeLogger,
        applicationUpdate,
        workspace: desktopMain.workspace,
        session: desktopMain.session,
        publishSessionMessageEvent: (event) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(IPC_CHANNELS.session.sessionMessagePresentation, event);
          }
        },
        skill: desktopMain.skill,
        settings: desktopMain.settings,
        approval: desktopMain.approval,
        discovery: desktopMain.discovery,
        voice: desktopMain.voice,
        voiceInput: desktopMain.voiceInput,
        character,
        observability: desktopMain.observability,
      });
      tray ??= createMegumiTray({
        iconPath: path.resolve(app.getAppPath?.() ?? process.cwd(), 'apps/desktop/assets/app-icon.ico'),
        showCharacter: () => { void character.show(); },
        hideCharacter: () => { void character.hide(); },
        showMainWindow: () => {
          showMainWindow();
        },
        quit: () => { void quitApplication(); },
      });
      if (character.shouldRestoreVisible()) void character.show();
    },
    createWindow: () => {
      mainWindow = createMainWindow({
        devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
        rendererName: MAIN_WINDOW_VITE_NAME,
        dirname: __dirname,
      });
      return mainWindow;
    },
    dispose: async () => {
      applicationUpdateSubscription();
      applicationUpdate.dispose();
      tray?.dispose();
      characterSubscription.unsubscribe();
      await character.dispose();
      await desktopMain.dispose();
    },
  });
  showMainWindow = () => lifecycle.showMainWindow();
  prepareToQuit = () => lifecycle.prepareToQuit();
  quitApplication = () => { void lifecycle.quit(); };
}

async function stopAfterBootstrapFailure(error: unknown): Promise<void> {
  console.error('Megumi Desktop bootstrap failed.', error);
  const recoveryShown = await showDesktopBootstrapFailure(error);
  if (!recoveryShown) {
    await app.whenReady();
    dialog.showErrorBox(
      'Megumi 启动失败',
      '桌面应用未能完成启动。请退出后重试，并保留日志以便诊断。',
    );
  }
  app.quit();
}
