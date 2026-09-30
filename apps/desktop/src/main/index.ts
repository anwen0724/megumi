/*
 * Boots the Electron Desktop Host and stops before Product startup when composition is unsafe.
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { loadEnvFile } from './config/env';
import { registerAllHandlers } from './ipc/register-ipc-handlers';
import { IPC_CHANNELS } from './ipc/channels';
import { createMainWindow } from './app/create-window';
import { getAppIconPath } from './app/app-icon';
import { createCharacterWindow } from './app/create-character-window';
import { createCharacterWindowController } from './app/character-window-controller';
import { createMegumiTray, type MegumiTray } from './app/create-tray';
import { registerAppLifecycle } from './app/lifecycle';
import { registerRuntimeProcessErrorHandlers } from './app/runtime-process-errors';
import { composeDesktopMain } from './shell-composition/desktop-main-composition';
import type { CharacterWindowController } from './app/character-window-controller';
import { createFileCharacterWindowStateStore } from './adapters/file-character-window-state-store';
import { showDesktopBootstrapFailure } from './app/bootstrap-failure';
import { composeApplicationUpdate } from './application-update/application-update-composition';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const MEGUMI_APP_ID: string;

if (process.platform === 'win32') app.setAppUserModelId(MEGUMI_APP_ID);

loadEnvFile();
try {
  startDesktop(composeDesktopMain());
} catch (error) {
  void stopAfterBootstrapFailure(error).catch((failure: unknown) => {
    console.error('Megumi Desktop could not present its bootstrap failure.', failure);
    app.quit();
  });
}

/** Composes the Desktop-owned surfaces and their single orderly shutdown boundary. */
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
      void desktopMain.start().then(() => applicationUpdate.start()).catch((error: unknown) => {
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
        settingsRecovery: {
          settingsPath: path.join(desktopMain.homePath, 'settings.json'),
          async openDirectory() {
            const error = await shell.openPath(desktopMain.homePath);
            if (error) throw new Error('The configuration directory could not be opened.');
          },
          async restart() {
            // Do not schedule a relaunch until all fallible shutdown work has completed.
            await lifecycle.prepareToQuit();
            app.relaunch();
            await lifecycle.quit();
          },
        },
        approval: desktopMain.approval,
        discovery: desktopMain.discovery,
        voice: desktopMain.voice,
        voiceInput: desktopMain.voiceInput,
        character,
        observability: desktopMain.observability,
      });
      tray ??= createMegumiTray({
        iconPath: getAppIconPath(),
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
      await character.dispose();
      await desktopMain.dispose();
    },
  });
  // Retain the shell and update feedback through preparation and installer launch failures.
  app.once('will-quit', () => {
    tray?.dispose();
    characterSubscription.unsubscribe();
    applicationUpdateSubscription();
    applicationUpdate.dispose();
  });
  showMainWindow = () => lifecycle.showMainWindow();
  prepareToQuit = () => lifecycle.prepareToQuit();
  quitApplication = () => {
    void lifecycle.quit().catch((error: unknown) => {
      desktopMain.runtimeLogger.warn('desktop_quit_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
  };
}

/** Presents a recoverable startup failure and guarantees the unsafe composition cannot remain resident. */
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
