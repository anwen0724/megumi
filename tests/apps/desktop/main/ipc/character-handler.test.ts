/* Protects native Character Presence shape, movement, and shell actions. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerCharacterHandlers } from '@megumi/desktop/main/ipc/handlers/character.handler';

describe('registerCharacterHandlers', () => {
  it('validates and connects shape, movement, and settings commands to the character window owner', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const controller = {
      show: vi.fn(),
      hide: vi.fn(),
      getSnapshot: vi.fn(),
      toggleAlwaysOnTop: vi.fn(),
      selectSession: vi.fn(),
      setShape: vi.fn(),
      moveTo: vi.fn(),
      openSettings: vi.fn(),
      setScale: vi.fn(),
      showMainWindow: vi.fn(),
    };

    registerCharacterHandlers({ controller: controller as never, ipcMain: { handle } });
    handlers.get(IPC_CHANNELS.character.setShape)?.({}, {
      rects: [{ x: 4, y: 8, width: 32, height: 64 }],
    });
    handlers.get(IPC_CHANNELS.character.moveTo)?.({}, { x: 120, y: 240 });
    handlers.get(IPC_CHANNELS.character.openSettings)?.({});
    handlers.get(IPC_CHANNELS.character.setScale)?.({}, { scale: 1.25 });
    handlers.get(IPC_CHANNELS.character.showMainWindow)?.({});

    expect(controller.setShape).toHaveBeenCalledWith([{ x: 4, y: 8, width: 32, height: 64 }]);
    expect(controller.moveTo).toHaveBeenCalledWith({ x: 120, y: 240 });
    expect(controller.openSettings).toHaveBeenCalledOnce();
    expect(controller.setScale).toHaveBeenCalledWith(1.25);
    expect(controller.showMainWindow).toHaveBeenCalledOnce();
  });
});
