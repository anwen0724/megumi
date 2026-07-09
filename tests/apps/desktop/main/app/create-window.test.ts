// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { loadURL, loadFile, browserWindowConstructor } = vi.hoisted(() => {
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  const browserWindowConstructor = vi.fn(function (this: Record<string, unknown>) {
    this.loadURL = loadURL;
    this.loadFile = loadFile;
    return this;
  });
  return { loadURL, loadFile, browserWindowConstructor };
});

vi.mock('electron', () => ({
  BrowserWindow: browserWindowConstructor,
}));

describe('createMainWindow', () => {
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
        frame: false,
        autoHideMenuBar: true,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        }),
      }),
    );
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(loadFile).not.toHaveBeenCalled();
  });
});
