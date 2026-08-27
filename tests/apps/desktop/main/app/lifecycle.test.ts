// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { whenReady, on, quit, getAllWindows } = vi.hoisted(() => ({
  whenReady: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  getAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { whenReady, on, quit },
  BrowserWindow: { getAllWindows },
}));

describe('registerAppLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whenReady.mockResolvedValue(undefined);
    getAllWindows.mockReturnValue([]);
  });

  it('runs startup work after Electron is ready', async () => {
    const registerAllHandlers = vi.fn();
    const window = { show: vi.fn(), hide: vi.fn(), focus: vi.fn(), isDestroyed: vi.fn(() => false), on: vi.fn() };
    const createWindow = vi.fn(() => window);
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');

    registerAppLifecycle({ registerAllHandlers, createWindow });
    await whenReady.mock.results[0].value;

    expect(registerAllHandlers).toHaveBeenCalledOnce();
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it('does not start Product background work until Electron is ready', async () => {
    let releaseReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    whenReady.mockReturnValueOnce(ready);
    const start = vi.fn();
    const window = { show: vi.fn(), hide: vi.fn(), focus: vi.fn(), isDestroyed: vi.fn(() => false), on: vi.fn() };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');

    registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window, start });
    expect(start).not.toHaveBeenCalled();

    releaseReady?.();
    await ready;
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
  });

  it('hides the main window on close and restores it on activate', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');

    registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window });
    await whenReady.mock.results[0].value;

    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    const activate = on.mock.calls.find(([event]) => event === 'activate')?.[1];
    activate?.();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  it('restores a minimized main window when an explicit shell action opens it', async () => {
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      isMinimized: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
    };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');
    const lifecycle = registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window });
    await whenReady.mock.results[0].value;

    lifecycle.showMainWindow();

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('does not turn application quit into another hide operation', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');

    registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window });
    await whenReady.mock.results[0].value;

    const beforeQuit = on.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    beforeQuit?.();
    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('starts quitting before app.quit when the tray requests exit with the main window visible', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    };
    const dispose = vi.fn();
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');
    const lifecycle = registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window, dispose });
    await whenReady.mock.results[0].value;

    await lifecycle.quit();
    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);

    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('awaits one shared disposal before quitting or handing control to an updater', async () => {
    let finishDisposal: (() => void) | undefined;
    const disposal = new Promise<void>((resolve) => { finishDisposal = resolve; });
    const dispose = vi.fn(() => disposal);
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
    };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');
    const lifecycle = registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window, dispose });
    await whenReady.mock.results[0].value;

    const prepared = lifecycle.prepareToQuit();
    const quitRequested = lifecycle.quit();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    finishDisposal?.();
    await Promise.all([prepared, quitRequested]);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('restores resident-window behavior when exit preparation fails', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce(undefined);
    const window = {
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    };
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');
    const lifecycle = registerAppLifecycle({ registerAllHandlers: vi.fn(), createWindow: () => window, dispose });
    await whenReady.mock.results[0].value;

    await expect(lifecycle.prepareToQuit()).rejects.toThrow('busy');
    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    await expect(lifecycle.prepareToQuit()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
