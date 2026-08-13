// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Desktop preload transport contract', () => {
  it('keeps every invoked business channel paired with a production handler', () => {
    const preload = fs.readFileSync(path.resolve('apps/desktop/src/preload/api.ts'), 'utf8');
    const handlers = fs.readdirSync(path.resolve('apps/desktop/src/main/ipc/handlers'))
      .filter((file) => file.endsWith('.handler.ts'))
      .map((file) => fs.readFileSync(path.resolve('apps/desktop/src/main/ipc/handlers', file), 'utf8'))
      .join('\n');

    const invoked = new Set([
      ...tokens(preload, /invokeRuntimeIpc\((IPC_CHANNELS\.[a-zA-Z.]+)/g),
      ...tokens(preload, /ipcRenderer\.invoke\((IPC_CHANNELS\.[a-zA-Z.]+)/g),
    ]);
    const registered = tokens(handlers, /ipcMain\.handle\(\s*(IPC_CHANNELS\.[a-zA-Z.]+)/g);
    expect([...invoked].sort()).toEqual([...registered].sort());
  });

  it('pairs the dedicated voice input frame and event channels with one-way transports', () => {
    const preload = fs.readFileSync(path.resolve('apps/desktop/src/preload/api.ts'), 'utf8');
    const handlers = fs.readdirSync(path.resolve('apps/desktop/src/main/ipc/handlers'))
      .filter((file) => file.endsWith('.handler.ts'))
      .map((file) => fs.readFileSync(path.resolve('apps/desktop/src/main/ipc/handlers', file), 'utf8'))
      .join('\n');

    // Frames are fire-and-forget sends; events are subscription-based.
    expect(preload).toMatch(/ipcRenderer\.send\(IPC_CHANNELS\.voice\.inputFrame/);
    expect(preload).toMatch(/ipcRenderer\.on\(IPC_CHANNELS\.voice\.inputEvent/);
    expect(preload).toMatch(/removeListener\(IPC_CHANNELS\.voice\.inputEvent/);
    // The frame channel has a real one-way handler; no invoke handler exists.
    expect(handlers).toMatch(/ipcMain\.on\(\s*IPC_CHANNELS\.voice\.inputFrame/);
    expect(handlers).not.toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.voice\.inputFrame/);
  });
});

function tokens(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}
