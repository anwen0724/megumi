import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileCharacterWindowStateStore } from '@megumi/desktop/main/adapters/file-character-window-state-store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('FileCharacterWindowStateStore', () => {
  it('round-trips valid bounds and always-on-top state atomically', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-character-state-'));
    roots.push(root);
    const store = createFileCharacterWindowStateStore({ filePath: path.join(root, 'state.json') });
    const state = { alwaysOnTop: false, visible: true, bounds: { x: 30, y: 40, width: 420, height: 720 } };

    store.save(state);

    expect(store.load()).toEqual(state);
    expect(fs.existsSync(path.join(root, 'state.json.tmp'))).toBe(false);
  });

  it('ignores corrupt or unsafe geometry instead of breaking window creation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-character-state-'));
    roots.push(root);
    const filePath = path.join(root, 'state.json');
    fs.writeFileSync(filePath, JSON.stringify({ alwaysOnTop: true, bounds: { x: 0, y: 0, width: -1, height: 0 } }));

    expect(createFileCharacterWindowStateStore({ filePath }).load()).toEqual({ alwaysOnTop: true, visible: false });
  });
});
