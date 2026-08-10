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

export interface CharacterWindowPersistedState {
  readonly bounds?: CharacterWindowBounds;
  readonly alwaysOnTop: boolean;
}

export interface CharacterWindowSnapshot extends CharacterWindowPersistedState {
  readonly visible: boolean;
  readonly selectedSessionId: string | null;
}

export interface CharacterWindowStateStore {
  load(): CharacterWindowPersistedState | undefined;
  save(state: CharacterWindowPersistedState): void;
}

export interface CharacterWindowHandle {
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(alwaysOnTop: boolean): void;
  getBounds(): CharacterWindowBounds;
  setBounds(bounds: CharacterWindowBounds): void;
  on(event: 'close' | 'closed' | 'move' | 'resize', listener: (...args: any[]) => void): void;
}

export interface CharacterWindowController {
  show(): Promise<CharacterWindowSnapshot>;
  hide(): Promise<CharacterWindowSnapshot>;
  toggleAlwaysOnTop(): CharacterWindowSnapshot;
  selectSession(sessionId: string | null): CharacterWindowSnapshot;
  getSnapshot(): CharacterWindowSnapshot;
  subscribe(listener: (snapshot: CharacterWindowSnapshot) => void): { unsubscribe(): void };
  dispose(): Promise<void>;
}

export function createCharacterWindowController(options: {
  readonly createWindow: () => CharacterWindowHandle;
  readonly endVoiceSession: () => Promise<unknown>;
  readonly stateStore?: CharacterWindowStateStore;
}): CharacterWindowController {
  let window: CharacterWindowHandle | undefined;
  let disposing = false;
  let selectedSessionId: string | null = null;
  let persisted = options.stateStore?.load() ?? { alwaysOnTop: true };
  const listeners = new Set<(snapshot: CharacterWindowSnapshot) => void>();

  const snapshot = (): CharacterWindowSnapshot => ({
    visible: Boolean(window && !window.isDestroyed() && window.isVisible()),
    alwaysOnTop: window && !window.isDestroyed() ? window.isAlwaysOnTop() : persisted.alwaysOnTop,
    ...(persisted.bounds ? { bounds: persisted.bounds } : {}),
    selectedSessionId,
  });

  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    return next;
  };

  const saveWindowState = () => {
    if (!window || window.isDestroyed()) return;
    persisted = {
      bounds: window.getBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
    };
    options.stateStore?.save(persisted);
  };

  const hide = async (): Promise<CharacterWindowSnapshot> => {
    await options.endVoiceSession();
    if (window && !window.isDestroyed()) {
      saveWindowState();
      window.hide();
    }
    return publish();
  };

  const ensureWindow = (): CharacterWindowHandle => {
    if (window && !window.isDestroyed()) return window;
    window = options.createWindow();
    if (persisted.bounds) window.setBounds(persisted.bounds);
    window.setAlwaysOnTop(persisted.alwaysOnTop);
    window.on('move', saveWindowState);
    window.on('resize', saveWindowState);
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
      return publish();
    },
    hide,
    toggleAlwaysOnTop() {
      const target = ensureWindow();
      target.setAlwaysOnTop(!target.isAlwaysOnTop());
      saveWindowState();
      return publish();
    },
    selectSession(sessionId) {
      selectedSessionId = sessionId;
      return publish();
    },
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async dispose() {
      disposing = true;
      await options.endVoiceSession();
      if (window && !window.isDestroyed()) {
        saveWindowState();
        window.destroy();
      }
      window = undefined;
      listeners.clear();
    },
  };
}
