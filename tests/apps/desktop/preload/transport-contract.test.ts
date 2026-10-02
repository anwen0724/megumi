/* Exercises the public Preload API with Electron as the transport boundary. */
// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { api } from '@megumi/desktop/preload/api';

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  return { ipcRenderer: Object.assign(new EventEmitter(), { invoke: vi.fn(), postMessage: vi.fn() }) };
});
vi.mock('electron', () => electron);
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { electron.ipcRenderer.removeAllListeners(); });

const snapshot = { status: 'idle', currentVersion: '0.2.2', platform: 'win32', arch: 'x64', automaticChecksEnabled: false };

describe('Desktop Preload transport', () => {
  it('returns a stable failure with the request identity when the main process is unreachable', async () => {
    electron.ipcRenderer.invoke.mockRejectedValueOnce(new Error('Transport closed'));
    expect(await api.tools.list()).toMatchObject({ ok: false,
      data: { code: 'ipc_invoke_failed' }, meta: { requestId: expect.any(String), channel: IPC_CHANNELS.tools.list } });
  });

  it('rejects malformed update snapshots and stops delivery after unsubscribe', async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ...snapshot, status: 'ready' });
    await expect(api.applicationUpdate.getSnapshot()).rejects.toThrow();
    electron.ipcRenderer.invoke.mockResolvedValueOnce(snapshot);
    expect(await api.applicationUpdate.getSnapshot()).toEqual(snapshot);
    const received: unknown[] = [];
    const unsubscribe = api.applicationUpdate.onSnapshot(value => received.push(value));
    electron.ipcRenderer.emit(IPC_CHANNELS.applicationUpdate.snapshotChanged, {}, { ...snapshot, assetPath: 'private' });
    electron.ipcRenderer.emit(IPC_CHANNELS.applicationUpdate.snapshotChanged, {}, snapshot);
    unsubscribe();
    electron.ipcRenderer.emit(IPC_CHANNELS.applicationUpdate.snapshotChanged, {}, { ...snapshot, status: 'checking' });
    expect(received).toEqual([snapshot]);
  });

  it('forwards only a voice port transferred from the same window on the voice channel', () => {
    const { port1, port2 } = new MessageChannel();
    function post(source: Window | null, type: string, ports: readonly unknown[]) {
      const event = new MessageEvent('message', { source, data: { type } });
      Object.defineProperty(event, 'ports', { value: ports });
      window.dispatchEvent(event);
    }
    try {
      post(null, IPC_CHANNELS.voice.inputPort, [port1]);
      post(window, 'unrelated', [port1]);
      post(window, IPC_CHANNELS.voice.inputPort, []);
      expect(electron.ipcRenderer.postMessage).not.toHaveBeenCalled();
      post(window, IPC_CHANNELS.voice.inputPort, [port1]);
      expect(electron.ipcRenderer.postMessage).toHaveBeenCalledTimes(1);
      const [channel, payload, transferred] = electron.ipcRenderer.postMessage.mock.calls[0]!;
      expect(channel).toBe(IPC_CHANNELS.voice.inputPort);
      expect(payload).toBeNull();
      expect(transferred).toHaveLength(1);
      expect(transferred[0]).toBe(port1);
    } finally { port1.close(); port2.close(); }
  });
});
