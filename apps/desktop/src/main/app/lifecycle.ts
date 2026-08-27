/*
 * Owns Desktop window residency and the single asynchronous application shutdown sequence.
 */
import { app } from 'electron';

export interface RegisterAppLifecycleOptions {
  registerAllHandlers: () => void;
  createWindow: () => LifecycleWindow;
  start?: () => void;
  dispose?: () => void | Promise<void>;
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
  /** Marks the application as quitting and waits for every composed resource to be released. */
  prepareToQuit(): Promise<void>;
  /** Completes the shared shutdown preparation before requesting a normal Electron quit. */
  quit(): Promise<void>;
}

/** Registers resident-window lifecycle behavior and returns the shared shutdown Interface. */
export function registerAppLifecycle({
  registerAllHandlers,
  createWindow,
  start,
  dispose,
}: RegisterAppLifecycleOptions): AppLifecycleController {
  let mainWindow: LifecycleWindow | undefined;
  let quitting = false;
  let disposalPromise: Promise<void> | undefined;

  const beginQuit = (): Promise<void> => {
    quitting = true;
    disposalPromise ??= Promise.resolve()
      .then(() => dispose?.())
      .catch((error: unknown) => {
        // A failed preparation must not leave the resident window behaving as if exit succeeded.
        quitting = false;
        disposalPromise = undefined;
        throw error;
      });
    return disposalPromise;
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
    start?.();
  });

  // Closing every visible surface keeps the private Agent resident for tray reopening.
  app.on('window-all-closed', () => undefined);

  app.on('activate', () => {
    openMainWindow();
  });

  app.on('before-quit', () => {
    void beginQuit();
  });

  return {
    showMainWindow: openMainWindow,
    prepareToQuit: beginQuit,
    async quit() {
      await beginQuit();
      app.quit();
    },
  };
}
