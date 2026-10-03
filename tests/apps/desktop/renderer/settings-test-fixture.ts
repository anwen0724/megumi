/* Connects renderer tests to real Settings files and the runtime model catalog. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { createSettings, type Settings } from '@megumi/application/settings/settings-store';
import { readModelCatalog } from '@megumi/application/application-capabilities';

/** Replaces Electron transport only; configuration parsing, merging and saving remain real. */
export function createSettingsFixture(initial: object = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-settings-'));
  const globalSettingsPath = path.join(root, 'settings.json');
  const credentialsPath = path.join(root, 'credentials.json');
  fs.writeFileSync(globalSettingsPath, JSON.stringify(initial));
  const settings = createSettings({
    globalSettingsPath,
    credentialsPath,
    readEnvironment: () => undefined,
  });
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = {
    settings: {
      async readSettings() {
        const result = settings.readSettings();
        return result.status === 'ok'
          ? { ok: true as const, data: result.settings }
          : { ok: false as const, data: result.error };
      },
      async updateSettings(request: Parameters<Settings['updateSettings']>[0]) {
        const result = settings.updateSettings(request);
        return result.status === 'rejected'
          ? { ok: false as const, data: result.error }
          : { ok: true as const, data: result };
      },
      async readCredential(request: Parameters<Settings['readCredential']>[0]) {
        const result = settings.readCredential(request);
        return result.status === 'rejected'
          ? { ok: false as const, data: result.error }
          : { ok: true as const, data: result };
      },
      async updateCredential(request: Parameters<Settings['updateCredential']>[0]) {
        const result = settings.updateCredential(request);
        return result.status === 'rejected'
          ? { ok: false as const, data: result.error }
          : { ok: true as const, data: result };
      },
      onChanged() {
        return () => {};
      },
    },
    models: {
      async getCatalog() {
        return { ok: true as const, data: readModelCatalog(settings) };
      },
    },
    tools: {
      async list() {
        return { ok: true as const, data: { tools: [] } };
      },
    },
  };
  return { root, globalSettingsPath, credentialsPath, settings, api };
}
