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
    const registered = tokens(handlers, /ipcMain\.handle\((IPC_CHANNELS\.[a-zA-Z.]+)/g);
    expect([...invoked].sort()).toEqual([...registered].sort());
  });
});

function tokens(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}
