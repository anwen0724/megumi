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

vi.mock('electron', () => ({ BrowserWindow: browserWindowConstructor }));

describe('createCharacterWindow', () => {
  it('creates a hidden transparent always-on-top character window with an explicit renderer role', async () => {
    const { createCharacterWindow } = await import('@megumi/desktop/main/app/create-character-window');

    createCharacterWindow({
      devServerUrl: 'http://localhost:5173',
      rendererName: 'main_window',
      dirname: 'C:/app/out/main',
    });

    expect(browserWindowConstructor).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Megumi Character',
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      backgroundColor: '#00000000',
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
      }),
    }));
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173/?megumiWindowRole=character');
    expect(loadFile).not.toHaveBeenCalled();
  });
});
