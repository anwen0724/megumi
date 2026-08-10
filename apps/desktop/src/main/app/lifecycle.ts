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
  isDestroyed(): boolean;
  on(event: 'close' | 'closed', listener: (...args: any[]) => void): void;
}

export function registerAppLifecycle({
  registerAllHandlers,
  createWindow,
  dispose,
}: RegisterAppLifecycleOptions): void {
  let mainWindow: LifecycleWindow | undefined;
  let quitting = false;

  const openMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
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

  app.on('will-quit', () => {
    quitting = true;
    dispose?.();
  });
}
