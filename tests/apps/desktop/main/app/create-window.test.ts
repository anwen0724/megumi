// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';

const { electronApp, loadURL, loadFile, setWindowOpenHandler, openExternal, browserWindowConstructor, screenBoundary } = vi.hoisted(() => {
  const electronApp = { isPackaged: false, getAppPath: () => process.cwd() };
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  const setWindowOpenHandler = vi.fn();
  const openExternal = vi.fn();
  const screenBoundary = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const browserWindowConstructor = vi.fn(function (this: Record<string, unknown>, options: BrowserWindowConstructorOptions) {
    const events = new EventEmitter();
    let bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 800, height: options.height ?? 600 };
    let maximized = false;
    let minimized = false;
    this.on = events.on.bind(events);
    this.once = events.once.bind(events);
    this.getBounds = () => bounds;
    this.getNormalBounds = () => bounds;
    this.setBounds = (next: Rectangle) => { bounds = next; events.emit('resize'); events.emit('move'); };
    this.isMaximized = () => maximized && !minimized;
    this.isMinimized = () => minimized;
    this.minimize = () => { minimized = true; events.emit('minimize'); };
    this.isFullScreen = () => false;
    this.maximize = () => { maximized = true; events.emit('maximize'); };
    this.unmaximize = () => { maximized = false; events.emit('unmaximize'); };
    this.close = () => { events.emit('close'); events.emit('closed'); };
    this.loadURL = loadURL;
    this.loadFile = loadFile;
    this.webContents = { setWindowOpenHandler };
    return this;
  });
  return { electronApp, loadURL, loadFile, setWindowOpenHandler, openExternal, browserWindowConstructor, screenBoundary };
});

vi.mock('electron', () => ({
  app: electronApp,
  BrowserWindow: browserWindowConstructor,
  shell: { openExternal },
  screen: {
    getPrimaryDisplay: () => ({ workArea: screenBoundary.workArea }),
    getDisplayMatching: () => ({ workArea: screenBoundary.workArea }),
  },
}));

const directories: string[] = [];

function windowStatePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-window-'));
  directories.push(directory);
  return path.join(directory, 'desktop', 'main-window.json');
}

describe('createMainWindow', () => {
  afterEach(() => {
    electronApp.isPackaged = false;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    screenBoundary.workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
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

  it('restores the resized window and its position after closing and starting again', async () => {
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const options = { rendererName: 'main_window', dirname: 'C:/app/out/main', stateFilePath: windowStatePath() };
    const original = createMainWindow(options);
    original.setBounds({ x: 110, y: 80, width: 1100, height: 740 });
    original.close();
    const restarted = createMainWindow(options);
    expect(restarted.getBounds()).toEqual({ x: 110, y: 80, width: 1100, height: 740 });
    restarted.close();
  });

  it('opens a smaller initial window that fits the available screen', async () => {
    screenBoundary.workArea = { x: 0, y: 0, width: 1280, height: 720 };
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const window = createMainWindow({ rendererName: 'main_window', dirname: 'C:/app/out/main' });
    expect(window.getBounds()).toEqual({ x: 64, y: 20, width: 1152, height: 680 });
  });

  it('restores maximization while retaining the user-sized normal window', async () => {
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const options = { rendererName: 'main_window', dirname: 'C:/app/out/main', stateFilePath: windowStatePath() };
    const original = createMainWindow(options);
    original.setBounds({ x: 110, y: 80, width: 1100, height: 740 });
    original.maximize();
    original.close();
    const restarted = createMainWindow(options);
    expect(restarted.isMaximized()).toBe(true);
    restarted.unmaximize();
    expect(restarted.getBounds()).toEqual({ x: 110, y: 80, width: 1100, height: 740 });
    restarted.close();
    const normal = createMainWindow(options);
    expect(normal.isMaximized()).toBe(false);
    normal.close();
  });

  it('keeps the restored window visible when its previous display is removed', async () => {
    screenBoundary.workArea = { x: 1920, y: 0, width: 1920, height: 1080 };
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const options = { rendererName: 'main_window', dirname: 'C:/app/out/main', stateFilePath: windowStatePath() };
    const original = createMainWindow(options);
    original.setBounds({ x: 2200, y: 80, width: 1500, height: 900 });
    original.close();
    screenBoundary.workArea = { x: 0, y: 0, width: 1280, height: 720 };
    const restarted = createMainWindow(options);
    expect(restarted.getBounds()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    restarted.close();
  });

  it('remembers the window when the application exits while minimized', async () => {
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const options = { rendererName: 'main_window', dirname: 'C:/app/out/main', stateFilePath: windowStatePath() };
    const original = createMainWindow(options);
    original.setBounds({ x: 110, y: 80, width: 1100, height: 740 });
    original.maximize();
    original.minimize();
    original.close();
    const restarted = createMainWindow(options);
    expect(restarted.isMaximized()).toBe(true);
    expect(restarted.getNormalBounds()).toEqual({ x: 110, y: 80, width: 1100, height: 740 });
    restarted.close();
  });

  it('opens with defaults when the saved window state is damaged', async () => {
    const { createMainWindow } = await import('@megumi/desktop/main/app/create-window');
    const stateFilePath = windowStatePath();
    fs.mkdirSync(path.dirname(stateFilePath));
    fs.writeFileSync(stateFilePath, '{"bounds":{"width":-1}}');
    const logger = { warn: vi.fn() };
    const window = createMainWindow({ rendererName: 'main_window', dirname: 'C:/app/out/main', stateFilePath, logger });
    expect(window.getBounds()).toEqual({ x: 360, y: 130, width: 1200, height: 820 });
    expect(logger.warn).toHaveBeenCalledWith('main_window_state_unreadable', expect.any(Object));
    window.close();
  });
});
