// Verifies the src desktop BrowserWindow preserves the migrated renderer chrome contract.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('src desktop createMainWindow', () => {
  beforeEach(() => {
    vi.resetModules();
    loadURL.mockClear();
    loadFile.mockClear();
    browserWindowConstructor.mockClear();
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
    vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
  });

  it('creates the migrated renderer window without native frame or menu chrome', async () => {
    const { createMainWindow } = await import('../../../src/desktop/window/create-window');

    const window = createMainWindow();

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
