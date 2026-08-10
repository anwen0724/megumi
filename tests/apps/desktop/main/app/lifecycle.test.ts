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
});
