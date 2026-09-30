/* Substitutes Electron's OS APIs while retaining the real updater and HTTP/file verification. */
import { EventEmitter } from 'node:events';
import { createRequire, Module } from 'node:module';
import childProcess from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

class ElectronAppBoundary extends EventEmitter {
  isPackaged = false;
  root = '';
  getVersion() { return '0.2.0'; }
  getName() { return 'megumi'; }
  getAppPath() { return this.root; }
  getPath(name: string) { return name === 'exe' ? path.join(this.root, 'installed', 'megumi.exe') : this.root; }
  async whenReady() { return undefined; }
  quit() {
    let prevented = false;
    this.emit('before-quit', { preventDefault: () => { prevented = true; } });
    if (!prevented) { this.emit('will-quit'); this.emit('quit', {}, 0); }
  }
  relaunch() { this.emit('relaunch'); }
}

export const electronBoundary = {
  app: new ElectronAppBoundary(),
  autoUpdater: new EventEmitter(),
  shell: { openExternal: async (_url: string) => undefined },
  session: { fromPartition: () => ({}) },
  net: { request: (options: http.RequestOptions) => http.request(options), fetch: globalThis.fetch },
  BrowserWindow: { getAllWindows: () => [] },
  processLaunches: [] as Array<{ file: string; args: string[] }>,
  spawnError: undefined as NodeJS.ErrnoException | undefined,
};

/** Covers CommonJS dependencies which resolve Electron outside Vitest's ESM transport. */
export function installElectronModuleBoundary(): () => void {
  const previousExecFileSync = childProcess.execFileSync;
  const previousSpawn = childProcess.spawn;
  electronBoundary.processLaunches.length = 0;
  electronBoundary.spawnError = undefined;
  Object.defineProperty(childProcess, 'spawn', { value: (file: string, args: string[] = []) => {
    electronBoundary.processLaunches.push({ file, args });
    const child = new childProcess.ChildProcess();
    const error = electronBoundary.spawnError;
    if (error) queueMicrotask(() => child.emit('error', error));
    else Object.defineProperty(child, 'pid', { value: 43210 });
    return child;
  } });
  Object.defineProperty(childProcess, 'execFileSync', { value: (file: string) => {
    if (!file.endsWith('powershell.exe')) throw new Error(`Unexpected OS command: ${file}`);
    return JSON.stringify({ AppId: 'com.megumi.desktop', Version: '0.2.0',
      InstallLocation: path.dirname(electronBoundary.app.getPath('exe')) });
  } });
  const require = createRequire(import.meta.url);
  const id = require.resolve('electron');
  const previous = require.cache[id];
  const replacement = new Module(id);
  replacement.exports = electronBoundary;
  require.cache[id] = replacement;
  return () => {
    Object.defineProperty(childProcess, 'execFileSync', { value: previousExecFileSync });
    Object.defineProperty(childProcess, 'spawn', { value: previousSpawn });
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  };
}
