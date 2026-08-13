import { app, BrowserWindow } from 'electron';
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
import { createCharacterSpeechPlayerAdapter } from './adapters/character-speech-player-adapter';
import type { CharacterWindowController } from './app/character-window-controller';
import { createFileCharacterWindowStateStore } from './adapters/file-character-window-state-store';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

if (shouldQuitForSquirrelStartup()) {
  app.quit();
} else {
  loadEnvFile();
  let character: CharacterWindowController | undefined;
  const speechPlayer = createCharacterSpeechPlayerAdapter({
    send: (channel, payload) => character?.send(channel, payload) ?? false,
  });
  const desktopMain = composeDesktopMain({ speechPlayer });
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
    registerAllHandlers: () => {
      registerAllHandlers({
        logger: desktopMain.runtimeLogger,
        workspace: desktopMain.workspace,
        session: desktopMain.session,
        skill: desktopMain.skill,
        settings: desktopMain.settings,
        approval: desktopMain.approval,
        voice: desktopMain.voice,
        voiceInput: desktopMain.voiceInput,
        speechPlayer,
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
        quit: () => quitApplication(),
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
      tray?.dispose();
      characterSubscription.unsubscribe();
      await character.dispose();
      await desktopMain.dispose();
    },
  });
  showMainWindow = () => lifecycle.showMainWindow();
  quitApplication = () => lifecycle.quit();
}
