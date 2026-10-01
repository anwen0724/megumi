/* Creates the branded main Desktop window and restricts external navigation. */
import { BrowserWindow, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'path';
import { z } from 'zod';
import { getAppIconPath } from './app-icon';
import type { DesktopRuntimeLogger } from '../runtime-logger';

const WindowStateSchema = z.object({
  bounds: z.object({
    x: z.number().int(), y: z.number().int(),
    width: z.number().int().positive(), height: z.number().int().positive(),
  }),
  maximized: z.boolean(),
});
type WindowState = z.infer<typeof WindowStateSchema>;

export interface CreateMainWindowOptions {
  devServerUrl?: string;
  rendererName: string;
  dirname: string;
  stateFilePath?: string;
  logger?: DesktopRuntimeLogger;
}

/** Creates the main surface with the native Megumi window and taskbar icon. */
export function createMainWindow({
  devServerUrl,
  rendererName,
  dirname,
  stateFilePath,
  logger = console,
}: CreateMainWindowOptions): BrowserWindow {
  const state = readWindowState(stateFilePath, logger);
  const mainWindow = new BrowserWindow({
    ...initialWindowBounds(state),
    icon: getAppIconPath(),
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f5ef',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'Megumi',
  });

  if (state?.maximized) mainWindow.maximize();
  if (stateFilePath) rememberWindowState(mainWindow, stateFilePath, logger);

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(dirname, `../renderer/${rendererName}/index.html`));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = safeExternalUrl(url);
    if (parsed) void shell.openExternal(parsed);
    return { action: 'deny' };
  });

  return mainWindow;
}

// Removed displays and smaller work areas must not leave the restored window off-screen.
function initialWindowBounds(state: WindowState | undefined) {
  const area = (state ? screen.getDisplayMatching(state.bounds) : screen.getPrimaryDisplay()).workArea;
  const minWidth = Math.min(1024, area.width);
  const minHeight = Math.min(680, area.height);
  const width = Math.min(area.width, Math.max(minWidth, state?.bounds.width ?? Math.min(1200, Math.round(area.width * 0.9))));
  const height = Math.min(area.height, Math.max(minHeight, state?.bounds.height ?? Math.min(820, Math.round(area.height * 0.9))));
  const x = Math.min(area.x + area.width - width, Math.max(area.x, state?.bounds.x ?? area.x + Math.round((area.width - width) / 2)));
  const y = Math.min(area.y + area.height - height, Math.max(area.y, state?.bounds.y ?? area.y + Math.round((area.height - height) / 2)));
  return { x, y, width, height, minWidth, minHeight };
}

// Missing state is normal on first launch; invalid state falls back without blocking startup.
function readWindowState(filePath: string | undefined, logger: DesktopRuntimeLogger): WindowState | undefined {
  if (!filePath) return undefined;
  try {
    return WindowStateSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      logger.warn('main_window_state_unreadable', { error: String(error) });
    }
    return undefined;
  }
}

// Save normal bounds rather than maximized geometry, and flush before hiding or exiting.
function rememberWindowState(window: BrowserWindow, filePath: string, logger: DesktopRuntimeLogger): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let maximized = window.isMaximized();
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  const cancelPending = () => { clearTimeout(pending); pending = undefined; };
  const save = () => {
    cancelPending();
    if (window.isFullScreen()) return;
    if (!window.isMinimized()) maximized = window.isMaximized();
    try {
      const state: WindowState = { bounds: window.getNormalBounds(), maximized };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryFile, filePath);
    } catch (error) {
      logger.warn('main_window_state_write_failed', { error: String(error) });
      try { fs.rmSync(temporaryFile, { force: true }); } catch (cleanupError) {
        logger.warn('main_window_state_cleanup_failed', { error: String(cleanupError) });
      }
    }
  };
  const scheduleSave = () => { cancelPending(); pending = setTimeout(save, 250); };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', () => { maximized = true; scheduleSave(); });
  window.on('unmaximize', () => { if (!window.isMinimized()) maximized = false; scheduleSave(); });
  window.on('close', save);
  window.on('closed', cancelPending);
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
