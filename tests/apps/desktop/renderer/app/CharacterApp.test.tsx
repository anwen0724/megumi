/* Protects the shaped Character Presence window and its click/drag/menu interactions. */
// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CharacterApp from '@megumi/desktop/renderer/app/CharacterApp';

const {
  createCharacterWindowShape,
  getSnapshot,
  hide,
  moveTo,
  openSettings,
  setScale,
  setShape,
  showMainWindow,
  toggleAlwaysOnTop,
} = vi.hoisted(() => ({
  createCharacterWindowShape: vi.fn(() => [{ x: 20, y: 20, width: 200, height: 500 }]),
  getSnapshot: vi.fn(),
  hide: vi.fn(),
  moveTo: vi.fn(),
  openSettings: vi.fn(),
  setScale: vi.fn(),
  setShape: vi.fn(),
  showMainWindow: vi.fn(),
  toggleAlwaysOnTop: vi.fn(),
}));

vi.mock('@megumi/desktop/renderer/features/character-presence', () => ({
  CharacterCanvas: (props: { readonly onLayout: (bounds: { left: number; top: number; width: number; height: number }) => void }) => (
    <button
      type="button"
      data-testid="character-canvas"
      onClick={() => props.onLayout({ left: 30, top: 70, width: 280, height: 590 })}
    />
  ),
  loadCharacterAlphaMask: vi.fn().mockResolvedValue({ width: 1, height: 1, alphaAt: () => 255 }),
  createCharacterWindowShape,
  CurrentInteractionView: () => <div data-testid="current-interaction" />,
  VoiceControls: () => <div data-testid="voice-controls" />,
  resolveCharacterState: () => 'idle',
  useCharacterInteraction: () => ({
    interaction: null,
    activeRunId: undefined,
    resolveApproval: vi.fn(),
    cancelRun: vi.fn(),
  }),
  useCharacterVoice: () => ({
    voiceSnapshot: { status: 'idle' },
    audioSnapshot: {
      microphone: 'closed',
      speech: 'stopped',
      level: 0,
      peak: 0,
      framesReceived: false,
      fallbackToDefault: false,
    },
    error: undefined,
    submitText: vi.fn(),
  }),
}));

describe('CharacterApp', () => {
  beforeEach(() => {
    getSnapshot.mockReset();
    createCharacterWindowShape.mockClear();
    hide.mockReset();
    moveTo.mockReset();
    openSettings.mockReset();
    setScale.mockReset();
    setShape.mockReset();
    showMainWindow.mockReset();
    toggleAlwaysOnTop.mockReset();
    getSnapshot.mockResolvedValue({
      visible: true,
      alwaysOnTop: true,
      scale: 1,
      selectedSessionId: 'session-1',
      bounds: { x: 10, y: 20, width: 720, height: 680 },
    });
    setScale.mockImplementation(async (scale: number) => ({
      visible: true,
      alwaysOnTop: true,
      scale,
      selectedSessionId: 'session-1',
      bounds: { x: 10, y: 20, width: 720, height: 680 },
    }));
    toggleAlwaysOnTop.mockResolvedValue({
      visible: true,
      alwaysOnTop: false,
      scale: 1,
      selectedSessionId: 'session-1',
      bounds: { x: 10, y: 20, width: 720, height: 680 },
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 340,
      bottom: 680,
      width: 340,
      height: 680,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        character: {
          getSnapshot,
          onSnapshot: vi.fn().mockReturnValue(vi.fn()),
          toggleAlwaysOnTop,
          hide,
          setShape,
          moveTo,
          openSettings,
          setScale,
          showMainWindow,
        },
      },
    });
  });

  it('waits for the persisted scale before mounting the Pixi character canvas', async () => {
    let resolveSnapshot!: (snapshot: {
      visible: boolean;
      alwaysOnTop: boolean;
      scale: number;
      selectedSessionId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }) => void;
    getSnapshot.mockReturnValue(new Promise((resolve) => { resolveSnapshot = resolve; }));

    render(<CharacterApp />);

    expect(screen.queryByTestId('character-canvas')).not.toBeInTheDocument();
    resolveSnapshot({
      visible: true,
      alwaysOnTop: true,
      scale: 0.91,
      selectedSessionId: 'session-1',
      bounds: { x: 10, y: 20, width: 601, height: 619 },
    });

    expect(await screen.findByTestId('character-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('character-viewport')).toHaveStyle({ width: '309px', height: '619px' });
  });

  it('uses a native shape and keeps the interaction panel absent until the character is clicked', async () => {
    render(<CharacterApp />);

    expect(screen.queryByTestId('character-interaction-panel')).not.toBeInTheDocument();
    const character = screen.getByTestId('character-viewport');
    fireEvent.pointerDown(character, { pointerId: 1, button: 0, screenX: 100, screenY: 120 });
    fireEvent.pointerUp(character, { pointerId: 1, button: 0, screenX: 100, screenY: 120 });

    const panel = await screen.findByTestId('character-interaction-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ left: '255px' });
    expect(screen.getByTestId('voice-controls')).toBeInTheDocument();
    expect(screen.getByTestId('current-interaction')).toBeInTheDocument();
    await waitFor(() => expect(setShape).toHaveBeenCalled());
  });

  it('builds the native shape from the bounds reported by the character renderer', async () => {
    render(<CharacterApp />);
    const canvas = await screen.findByTestId('character-canvas');

    fireEvent.click(canvas);

    await waitFor(() => expect(createCharacterWindowShape).toHaveBeenCalledWith(expect.objectContaining({
      renderedBounds: { left: 30, top: 70, width: 280, height: 590 },
    })));
  });

  it('moves the native window after the drag threshold without opening the panel', async () => {
    render(<CharacterApp />);
    const character = screen.getByTestId('character-viewport');
    await screen.findByTestId('character-canvas');

    fireEvent.pointerDown(character, { pointerId: 2, button: 0, screenX: 100, screenY: 120 });
    fireEvent.pointerMove(character, { pointerId: 2, screenX: 112, screenY: 138 });
    fireEvent.pointerUp(character, { pointerId: 2, button: 0, screenX: 112, screenY: 138 });

    expect(moveTo).toHaveBeenCalledWith(22, 38);
    expect(screen.queryByTestId('character-interaction-panel')).not.toBeInTheDocument();
  });

  it('opens management actions on right click instead of showing persistent window buttons', async () => {
    render(<CharacterApp />);

    expect(screen.queryByTestId('character-window-controls')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('character-viewport'));
    const menu = await screen.findByTestId('character-management-menu');
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveStyle({ left: '255px' });
    expect(screen.getByTestId('character-viewport').className).not.toContain('drop-shadow');

    await userEvent.click(screen.getByRole('menuitem', { name: /show main window|显示主界面/i }));
    expect(showMainWindow).toHaveBeenCalledOnce();

    fireEvent.contextMenu(screen.getByTestId('character-viewport'));
    await userEvent.click(screen.getByRole('menuitem', { name: /settings|设置/i }));
    expect(openSettings).toHaveBeenCalledOnce();

    fireEvent.contextMenu(screen.getByTestId('character-viewport'));
    await userEvent.click(screen.getByRole('menuitem', { name: /hide|隐藏/i }));
    expect(hide).toHaveBeenCalledOnce();
  });

  it('keeps the interaction panel fixed while changing only the character scale', async () => {
    render(<CharacterApp />);
    await screen.findByTestId('character-canvas');

    fireEvent.contextMenu(screen.getByTestId('character-viewport'));
    fireEvent.change(screen.getByRole('slider', { name: /character size|人物大小/i }), {
      target: { value: '125' },
    });

    await waitFor(() => expect(setScale).toHaveBeenCalledWith(1.25));
    expect(screen.getByTestId('character-viewport')).toHaveStyle({ width: '425px', height: '850px' });
  });

  it('uses Megumi as the panel eyebrow instead of repeating Current interaction', async () => {
    render(<CharacterApp />);
    const character = screen.getByTestId('character-viewport');
    fireEvent.pointerDown(character, { pointerId: 4, button: 0, screenX: 100, screenY: 120 });
    fireEvent.pointerUp(character, { pointerId: 4, button: 0, screenX: 100, screenY: 120 });

    const panel = await screen.findByTestId('character-interaction-panel');
    expect(panel).toHaveTextContent('Megumi');
  });

  it('does not force an opaque body background before the character renderer starts', () => {
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/desktop/src/renderer/index.html'),
      'utf8',
    );

    expect(html).not.toContain('bg-gray-950');
  });
});
