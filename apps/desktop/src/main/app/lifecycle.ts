import { app } from 'electron';

export interface RegisterAppLifecycleOptions {
  registerAllHandlers: () => void;
  createWindow: () => LifecycleWindow;
  dispose?: () => void;
}

export interface LifecycleWindow {
  show(): void;
  hide(): void;
  focus(): void;
  restore?(): void;
  isMinimized?(): boolean;
  isDestroyed(): boolean;
  on(event: 'close' | 'closed', listener: (...args: any[]) => void): void;
}

export interface AppLifecycleController {
  showMainWindow(): void;
  quit(): void;
}

export function registerAppLifecycle({
  registerAllHandlers,
  createWindow,
  dispose,
}: RegisterAppLifecycleOptions): AppLifecycleController {
  let mainWindow: LifecycleWindow | undefined;
  let quitting = false;
  let disposalStarted = false;

  const beginQuit = () => {
    quitting = true;
    if (disposalStarted) return;
    disposalStarted = true;
    dispose?.();
  };

  const openMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized?.()) mainWindow.restore?.();
      mainWindow.show();
      mainWindow.focus();
      return;
    }

    mainWindow = createWindow();
    mainWindow.on('close', (event: { preventDefault(): void }) => {
      if (quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });
    mainWindow.on('closed', () => {
      mainWindow = undefined;
    });
  };

  app.whenReady().then(() => {
    registerAllHandlers();
    openMainWindow();
  });

  // Closing every visible surface keeps the private Agent resident for tray reopening.
  app.on('window-all-closed', () => undefined);

  app.on('activate', () => {
    openMainWindow();
  });

  app.on('before-quit', () => {
    beginQuit();
  });

  return {
    showMainWindow: openMainWindow,
    quit() {
      beginQuit();
      app.quit();
    },
  };
}
