// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCharacterWindowController } from '@megumi/desktop/main/app/character-window-controller';

function createWindowDouble() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let visible = false;
  let alwaysOnTop = true;
  let destroyed = false;
  return {
    webContents: { send: vi.fn() },
    show: vi.fn(() => { visible = true; }),
    hide: vi.fn(() => { visible = false; }),
    focus: vi.fn(),
    destroy: vi.fn(() => { destroyed = true; }),
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => destroyed),
    isAlwaysOnTop: vi.fn(() => alwaysOnTop),
    setAlwaysOnTop: vi.fn((next: boolean) => { alwaysOnTop = next; }),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 360, height: 680 })),
    setBounds: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, listener); }),
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args),
  };
}

describe('CharacterWindowController', () => {
  it('owns one window instance and publishes the latest main-window Session selection', async () => {
    const window = createWindowDouble();
    const createWindow = vi.fn(() => window);
    const controller = createCharacterWindowController({
      createWindow,
      endVoiceSession: vi.fn(),
    });
    const snapshots: unknown[] = [];
    controller.subscribe((snapshot) => snapshots.push(snapshot));

    await controller.show();
    await controller.show();
    controller.selectSession('session-2');

    expect(createWindow).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      visible: true,
      alwaysOnTop: true,
      selectedSessionId: 'session-2',
    });
    expect(snapshots.at(-1)).toEqual(controller.getSnapshot());
  });

  it('ends Voice Session before hiding and turns close into hide until disposal', async () => {
    const window = createWindowDouble();
    const order: string[] = [];
    window.hide.mockImplementation(() => { order.push('hide'); });
    const endVoiceSession = vi.fn(async () => { order.push('end'); });
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession,
    });
    await controller.show();

    const preventDefault = vi.fn();
    window.emit('close', { preventDefault });
    await vi.waitFor(() => expect(endVoiceSession).toHaveBeenCalledOnce());

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(order).toEqual(['end', 'hide']);

    await controller.dispose();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it('restores and persists bounds and always-on-top state', async () => {
    const window = createWindowDouble();
    const save = vi.fn();
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession: vi.fn(),
      stateStore: {
        load: () => ({ bounds: { x: 1, y: 2, width: 420, height: 720 }, alwaysOnTop: false, visible: true }),
        save,
      },
    });

    expect(controller.shouldRestoreVisible()).toBe(true);
    await controller.show();
    expect(window.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 420, height: 720 });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false);

    controller.toggleAlwaysOnTop();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ alwaysOnTop: true, visible: true }));

    await controller.hide();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  });
});
