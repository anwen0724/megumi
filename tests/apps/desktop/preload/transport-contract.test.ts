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
    const characterVoice = fs.readFileSync(
      path.resolve('apps/desktop/src/renderer/features/character-presence/use-character-voice.ts'),
      'utf8',
    );
    const handlers = fs.readdirSync(path.resolve('apps/desktop/src/main/ipc/handlers'))
      .filter((file) => file.endsWith('.handler.ts'))
      .map((file) => fs.readFileSync(path.resolve('apps/desktop/src/main/ipc/handlers', file), 'utf8'))
      .join('\n');

    // A MessagePort cannot cross a contextBridge function argument. The Renderer
    // transfers it to the isolated Preload with window.postMessage first; only
    // then may Preload forward the received port to Main.
    expect(characterVoice).toMatch(/window\.postMessage\([\s\S]*IPC_CHANNELS\.voice\.inputPort/);
    expect(preload).toMatch(/window\.addEventListener\(['"]message['"]/);
    expect(preload).toMatch(/event\.ports/);
    expect(preload).toMatch(/ipcRenderer\.postMessage\(IPC_CHANNELS\.voice\.inputPort/);
    expect(preload).not.toMatch(/postFramePort:\s*\(port:\s*MessagePort\)/);
    expect(preload).toMatch(/ipcRenderer\.on\(IPC_CHANNELS\.voice\.inputEvent/);
    expect(preload).toMatch(/removeListener\(IPC_CHANNELS\.voice\.inputEvent/);
    // The port channel has a real one-way handler; no invoke handler exists.
    expect(handlers).toMatch(/ipcMain\.on\(\s*IPC_CHANNELS\.voice\.inputPort/);
    expect(handlers).not.toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.voice\.inputPort/);
  });
});

function tokens(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}
