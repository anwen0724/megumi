/* Verifies explicit credential reads and secret-free configuration across desktop IPC. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettings } from '@megumi/application/settings/settings-store';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerSettingsHandlers } from '@megumi/desktop/main/ipc/handlers/settings.handler';
import type { DesktopIpcMain } from '@megumi/desktop/main/adapters/electron-ipc-main-adapter';

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Settings IPC', () => {
  it('returns the effective secret only through credential reads and preserves field errors', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-ipc-'));
    directories.push(root);
    const settings = createSettings({
      globalSettingsPath: path.join(root, 'settings.json'),
      credentialsPath: path.join(root, 'credentials.json'),
      readEnvironment: () => undefined,
    });
    const handlers = new Map<string, Parameters<DesktopIpcMain['handle']>[1]>();
    registerSettingsHandlers(
      { host: { settings } },
      {
        ipcMain: {
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          on: vi.fn(),
        },
        notifyChanged: () => undefined,
      },
    );
    const invoke = (channel: string, payload: unknown) =>
      handlers.get(channel)!({} as IpcMainInvokeEvent, {
        requestId: 'request:test',
        payload,
        meta: { channel, source: 'renderer', createdAt: new Date().toISOString() },
      });
    const target = { kind: 'discoverySource', sourceId: 'zhihu' };
    const saved = await invoke(IPC_CHANNELS.credentials.update, { target, value: 'test-secret' });
    expect(saved).toMatchObject({ ok: true, data: { status: 'updated' } });
    expect(JSON.stringify(saved)).not.toContain('test-secret');
    expect(await invoke(IPC_CHANNELS.credentials.read, { target })).toMatchObject({
      ok: true,
      data: { status: 'found', value: 'test-secret', source: 'stored' },
    });
    expect(JSON.stringify(await invoke(IPC_CHANNELS.settings.read, {}))).not.toContain(
      'test-secret',
    );
    fs.writeFileSync(
      path.join(root, 'settings.json'),
      JSON.stringify({ context: { compactionThresholdRatio: 2 } }),
    );
    expect(await invoke(IPC_CHANNELS.settings.read, {})).toMatchObject({
      ok: false,
      data: {
        code: 'SETTINGS_INVALID',
        issues: [{ path: ['context', 'compactionThresholdRatio'] }],
      },
    });
    await invoke(IPC_CHANNELS.credentials.update, { target, value: null });
    expect(
      settings.readCredential({ target: { kind: 'discoverySource', sourceId: 'zhihu' } }),
    ).toEqual({ status: 'missing' });
  });
});
