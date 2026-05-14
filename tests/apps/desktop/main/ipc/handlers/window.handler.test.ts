// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handle, fromWebContents } = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
  BrowserWindow: { fromWebContents },
}));

describe('registerWindowHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
    fromWebContents.mockReset();
  });

  it('registers clean window control IPC handlers', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerWindowHandlers } = await import('@megumi/desktop/main/ipc/handlers/window.handler');

    registerWindowHandlers();

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.window.minimize, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.window.toggleMaximize, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.window.close, expect.any(Function));
  });

  it('minimizes the sender window', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerWindowHandlers } = await import('@megumi/desktop/main/ipc/handlers/window.handler');
    const minimize = vi.fn();
    const sender = {};

    fromWebContents.mockReturnValue({ minimize });
    registerWindowHandlers();

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.window.minimize)?.[1];
    await handler({ sender });

    expect(fromWebContents).toHaveBeenCalledWith(sender);
    expect(minimize).toHaveBeenCalledTimes(1);
  });

  it('maximizes a restored sender window', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerWindowHandlers } = await import('@megumi/desktop/main/ipc/handlers/window.handler');
    const maximize = vi.fn();
    const unmaximize = vi.fn();

    fromWebContents.mockReturnValue({
      isMaximized: () => false,
      maximize,
      unmaximize,
    });
    registerWindowHandlers();

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.window.toggleMaximize)?.[1];
    await handler({ sender: {} });

    expect(maximize).toHaveBeenCalledTimes(1);
    expect(unmaximize).not.toHaveBeenCalled();
  });

  it('restores a maximized sender window', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerWindowHandlers } = await import('@megumi/desktop/main/ipc/handlers/window.handler');
    const maximize = vi.fn();
    const unmaximize = vi.fn();

    fromWebContents.mockReturnValue({
      isMaximized: () => true,
      maximize,
      unmaximize,
    });
    registerWindowHandlers();

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.window.toggleMaximize)?.[1];
    await handler({ sender: {} });

    expect(unmaximize).toHaveBeenCalledTimes(1);
    expect(maximize).not.toHaveBeenCalled();
  });

  it('closes the sender window', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerWindowHandlers } = await import('@megumi/desktop/main/ipc/handlers/window.handler');
    const close = vi.fn();

    fromWebContents.mockReturnValue({ close });
    registerWindowHandlers();

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.window.close)?.[1];
    await handler({ sender: {} });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
