// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const { electronApp, loadURL, loadFile, setWindowOpenHandler, openExternal, browserWindowConstructor } = vi.hoisted(() => {
  const electronApp = { isPackaged: false, getAppPath: () => process.cwd() };
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  const setWindowOpenHandler = vi.fn();
  const openExternal = vi.fn();
  const browserWindowConstructor = vi.fn(function (this: Record<string, unknown>) {
    this.loadURL = loadURL;
    this.loadFile = loadFile;
    this.webContents = { setWindowOpenHandler };
    return this;
  });
  return { electronApp, loadURL, loadFile, setWindowOpenHandler, openExternal, browserWindowConstructor };
});

vi.mock('electron', () => ({
  app: electronApp,
  BrowserWindow: browserWindowConstructor,
  shell: { openExternal },
}));

describe('createMainWindow', () => {
  afterEach(() => {
    electronApp.isPackaged = false;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the installed icon from resources instead of the excluded source tree', async () => {
    electronApp.isPackaged = true;
    vi.stubGlobal('process', { ...process, resourcesPath: path.resolve('installed/resources') });
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    createMainWindow({ rendererName: 'main_window', dirname: 'C:/installed/resources/app.asar/.vite/build' });
    expect(browserWindowConstructor).toHaveBeenCalledWith(expect.objectContaining({
      icon: path.resolve('installed/resources/desktop/app-icon.ico'),
    }));
  });
  it('creates a frameless main BrowserWindow with hidden native menu and loads the dev server URL', async () => {
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');

    const window = createMainWindow({
      devServerUrl: 'http://localhost:5173',
      rendererName: 'main_window',
      dirname: 'C:/app/out/main',
    });

    expect(window).toBeDefined();
    expect(browserWindowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Megumi',
        icon: path.resolve('apps/desktop/assets/app-icon.ico'),
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: '#f3f5ef',
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        }),
      }),
    );
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(loadFile).not.toHaveBeenCalled();

    const handleOpen = setWindowOpenHandler.mock.calls[0][0];
    expect(handleOpen({ url: 'https://example.com/article' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/article');
    expect(handleOpen({ url: 'file:///C:/secret.txt' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledOnce();
  });
});
