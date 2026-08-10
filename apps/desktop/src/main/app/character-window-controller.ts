/*
 * Owns the single Character Presence window and its shell-level persisted state.
 * It coordinates hiding with Voice Session cleanup without owning Agent or Session facts.
 */

export interface CharacterWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CharacterWindowShapeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CharacterWindowPersistedState {
  readonly bounds?: CharacterWindowBounds;
  readonly alwaysOnTop: boolean;
  readonly visible: boolean;
  readonly scale?: number;
}

export interface CharacterWindowSnapshot extends Omit<CharacterWindowPersistedState, 'scale'> {
  readonly scale: number;
  readonly selectedSessionId: string | null;
}

export interface CharacterWindowStateStore {
  load(): CharacterWindowPersistedState | undefined;
  save(state: CharacterWindowPersistedState): void;
}

export interface CharacterWindowHandle {
  readonly webContents: { send(channel: string, payload: unknown): void };
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(alwaysOnTop: boolean): void;
  setShape(rects: CharacterWindowShapeRect[]): void;
  setPosition(x: number, y: number, animate?: boolean): void;
  getBounds(): CharacterWindowBounds;
  setBounds(bounds: CharacterWindowBounds): void;
  on(event: 'close' | 'closed' | 'move' | 'resize', listener: (...args: any[]) => void): void;
}

export interface CharacterWindowController {
  show(): Promise<CharacterWindowSnapshot>;
  hide(): Promise<CharacterWindowSnapshot>;
  toggleAlwaysOnTop(): CharacterWindowSnapshot;
  setScale(scale: number): CharacterWindowSnapshot;
  setShape(rects: CharacterWindowShapeRect[]): void;
  moveTo(position: { readonly x: number; readonly y: number }): void;
  showMainWindow(): void;
  openSettings(): void;
  selectSession(sessionId: string | null): CharacterWindowSnapshot;
  shouldRestoreVisible(): boolean;
  getSnapshot(): CharacterWindowSnapshot;
  send(channel: string, payload: unknown): boolean;
  subscribe(listener: (snapshot: CharacterWindowSnapshot) => void): { unsubscribe(): void };
  dispose(): Promise<void>;
}

export function createCharacterWindowController(options: {
  readonly createWindow: () => CharacterWindowHandle;
  readonly endVoiceSession: () => Promise<unknown>;
  readonly showMainWindow?: () => void;
  readonly openSettings?: () => void;
  readonly stateStore?: CharacterWindowStateStore;
}): CharacterWindowController {
  let window: CharacterWindowHandle | undefined;
  let disposing = false;
  let selectedSessionId: string | null = null;
  let persisted: CharacterWindowPersistedState = options.stateStore?.load()
    ?? { alwaysOnTop: true, visible: false, scale: 1 };
  const listeners = new Set<(snapshot: CharacterWindowSnapshot) => void>();

  const snapshot = (): CharacterWindowSnapshot => ({
    visible: Boolean(window && !window.isDestroyed() && window.isVisible()),
    alwaysOnTop: window && !window.isDestroyed() ? window.isAlwaysOnTop() : persisted.alwaysOnTop,
    scale: normalizeScale(persisted.scale),
    ...(persisted.bounds ? { bounds: persisted.bounds } : {}),
    selectedSessionId,
  });

  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    return next;
  };

  const saveWindowState = (visible = persisted.visible) => {
    if (!window || window.isDestroyed()) return;
    persisted = {
      bounds: window.getBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
      visible,
      scale: normalizeScale(persisted.scale),
    };
    options.stateStore?.save(persisted);
  };

  const hide = async (): Promise<CharacterWindowSnapshot> => {
    await options.endVoiceSession();
    if (window && !window.isDestroyed()) {
      window.hide();
      saveWindowState(false);
    }
    return publish();
  };

  const ensureWindow = (): CharacterWindowHandle => {
    if (window && !window.isDestroyed()) return window;
    window = options.createWindow();
    if (persisted.bounds) {
      window.setBounds(resizeBoundsForScale(persisted.bounds, normalizeScale(persisted.scale)));
    }
    window.setAlwaysOnTop(persisted.alwaysOnTop);
    const saveAndPublishWindowState = () => {
      saveWindowState();
      publish();
    };
    window.on('move', saveAndPublishWindowState);
    window.on('resize', saveAndPublishWindowState);
    window.on('close', (event: { preventDefault(): void }) => {
      if (disposing) return;
      event.preventDefault();
      void hide();
    });
    window.on('closed', () => {
      window = undefined;
      publish();
    });
    return window;
  };

  return {
    async show() {
      const target = ensureWindow();
      target.show();
      target.focus();
      saveWindowState(true);
      return publish();
    },
    hide,
    toggleAlwaysOnTop() {
      const target = ensureWindow();
      target.setAlwaysOnTop(!target.isAlwaysOnTop());
      saveWindowState(target.isVisible());
      return publish();
    },
    setScale(scale) {
      const target = ensureWindow();
      const nextScale = normalizeScale(scale);
      const nextBounds = resizeBoundsForScale(target.getBounds(), nextScale);
      target.setBounds(nextBounds);
      persisted = {
        bounds: nextBounds,
        alwaysOnTop: target.isAlwaysOnTop(),
        visible: target.isVisible(),
        scale: nextScale,
      };
      options.stateStore?.save(persisted);
      return publish();
    },
    setShape(rects) {
      if (!window || window.isDestroyed()) return;
      window.setShape(rects);
    },
    moveTo(position) {
      if (!window || window.isDestroyed()) return;
      window.setPosition(position.x, position.y, false);
    },
    showMainWindow() {
      options.showMainWindow?.();
    },
    openSettings() {
      options.openSettings?.();
    },
    selectSession(sessionId) {
      selectedSessionId = sessionId;
      return publish();
    },
    shouldRestoreVisible() {
      return persisted.visible;
    },
    getSnapshot: snapshot,
    send(channel, payload) {
      if (!window || window.isDestroyed()) return false;
      window.webContents.send(channel, payload);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async dispose() {
      disposing = true;
      await options.endVoiceSession();
      if (window && !window.isDestroyed()) {
        saveWindowState(window.isVisible());
        window.destroy();
      }
      window = undefined;
      listeners.clear();
    },
  };
}

const CHARACTER_BASE_WIDTH = 340;
const CHARACTER_BASE_HEIGHT = 680;
const CHARACTER_VISIBLE_RIGHT_RATIO = 0.72;
const COMPANION_SURFACE_WIDTH = 356;
const SURFACE_GAP = 10;
const WINDOW_TRAILING_MARGIN = 12;

function normalizeScale(scale: number | undefined): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1.3, Math.max(0.7, scale ?? 1));
}

function resizeBoundsForScale(bounds: CharacterWindowBounds, scale: number): CharacterWindowBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.round(CHARACTER_BASE_WIDTH * scale * CHARACTER_VISIBLE_RIGHT_RATIO)
      + SURFACE_GAP
      + COMPANION_SURFACE_WIDTH
      + WINDOW_TRAILING_MARGIN,
    height: Math.round(CHARACTER_BASE_HEIGHT * scale),
  };
}
