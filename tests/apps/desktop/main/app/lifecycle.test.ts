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
    const runMigrations = vi.fn();
    const registerAllHandlers = vi.fn();
    const createWindow = vi.fn();
    const { registerAppLifecycle } = await import('@megumi/desktop/main/app/lifecycle');

    registerAppLifecycle({ runMigrations, registerAllHandlers, createWindow });
    await whenReady.mock.results[0].value;

    expect(runMigrations).toHaveBeenCalledOnce();
    expect(registerAllHandlers).toHaveBeenCalledOnce();
    expect(createWindow).toHaveBeenCalledOnce();
  });
});
