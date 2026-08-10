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
    setShape: vi.fn(),
    setPosition: vi.fn(),
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
        load: () => ({ bounds: { x: 1, y: 2, width: 420, height: 720 }, alwaysOnTop: false, visible: true, scale: 1 }),
        save,
      },
    });

    expect(controller.shouldRestoreVisible()).toBe(true);
    await controller.show();
    expect(window.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 623, height: 680 });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false);

    controller.toggleAlwaysOnTop();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ alwaysOnTop: true, visible: true }));

    await controller.hide();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  });

  it('persists character scale and resizes only the native character envelope', async () => {
    const window = createWindowDouble();
    const save = vi.fn();
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession: vi.fn(),
      stateStore: { load: () => undefined, save },
    });
    await controller.show();

    const snapshot = controller.setScale(1.25);

    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 684, height: 850 });
    expect(snapshot.scale).toBe(1.25);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 1.25 }));
  });

  it('opens the main window through the shell callback', () => {
    const showMainWindow = vi.fn();
    const controller = createCharacterWindowController({
      createWindow: createWindowDouble,
      endVoiceSession: vi.fn(),
      showMainWindow,
    });

    controller.showMainWindow();

    expect(showMainWindow).toHaveBeenCalledOnce();
  });

  it('applies the renderer-computed native window shape', async () => {
    const window = createWindowDouble();
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession: vi.fn(),
    });
    await controller.show();

    controller.setShape([{ x: 12, y: 24, width: 80, height: 120 }]);

    expect(window.setShape).toHaveBeenCalledWith([{ x: 12, y: 24, width: 80, height: 120 }]);
  });

  it('moves the window without turning the character surface click-through', async () => {
    const window = createWindowDouble();
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession: vi.fn(),
    });
    await controller.show();

    controller.moveTo({ x: 120, y: 240 });

    expect(window.setPosition).toHaveBeenCalledWith(120, 240, false);
  });

  it('publishes moved bounds so the next drag starts from the live window position', async () => {
    const window = createWindowDouble();
    window.getBounds.mockReturnValue({ x: 120, y: 240, width: 720, height: 680 });
    const controller = createCharacterWindowController({
      createWindow: () => window,
      endVoiceSession: vi.fn(),
    });
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.show();

    window.emit('move');

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      bounds: { x: 120, y: 240, width: 720, height: 680 },
    }));
  });
});
