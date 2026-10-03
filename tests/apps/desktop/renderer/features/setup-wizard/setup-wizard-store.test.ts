// @vitest-environment jsdom
/* Exercises setup persistence and retry through real Settings files. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettings, type Settings } from '@megumi/application/settings/settings-store';
import { readModelCatalog } from '@megumi/application/settings/resolve-model';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useModelSelectionStore } from '@megumi/desktop/renderer/entities/model-selection';

let root: string;
let settings: Settings;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-settings-'));
  settings = createSettings({
    globalSettingsPath: path.join(root, 'settings.json'),
    credentialsPath: path.join(root, 'credentials.json'),
    readEnvironment: () => undefined,
  });
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      settings: {
        readSettings: async () => {
          const result = settings.readSettings();
          return result.status === 'ok'
            ? { ok: true, data: result.settings }
            : { ok: false, data: result.error };
        },
        updateSettings: async (request: Parameters<Settings['updateSettings']>[0]) => {
          const result = settings.updateSettings(request);
          return result.status === 'rejected'
            ? { ok: false, data: result.error }
            : { ok: true, data: result };
        },
        updateCredential: async (request: Parameters<Settings['updateCredential']>[0]) => {
          const result = settings.updateCredential(request);
          return result.status === 'rejected'
            ? { ok: false, data: result.error }
            : { ok: true, data: result };
        },
      },
      models: { getCatalog: async () => ({ ok: true, data: readModelCatalog(settings) }) },
    },
  });
  useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
  useModelSelectionStore.setState(useModelSelectionStore.getInitialState(), true);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Setup persistence', () => {
  it('saves completion after configuration and credentials and retains it on a new read', async () => {
    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      providerId: 'deepseek',
      modelIds: ['deepseek-flash'],
      apiKey: 'test-key',
    });
    expect(useSetupWizardStore.getState()).toMatchObject({ status: 'ready', setupCompleted: true });
    const reopened = createSettings({
      globalSettingsPath: path.join(root, 'settings.json'),
      credentialsPath: path.join(root, 'credentials.json'),
      readEnvironment: () => undefined,
    });
    expect(reopened.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { setupCompleted: true },
          providers: { deepseek: { models: { 'deepseek-flash': {} } } },
        },
      },
    });
    expect(
      reopened.readCredential({ target: { kind: 'provider', providerId: 'deepseek' } }),
    ).toMatchObject({ status: 'found', value: 'test-key' });
    expect(fs.readFileSync(path.join(root, 'settings.json'), 'utf8')).not.toContain('test-key');
    expect(JSON.stringify(useSetupWizardStore.getState())).not.toContain('test-key');
  });
  it('retains saved configuration on credential failure and finishes after repair', async () => {
    fs.writeFileSync(path.join(root, 'credentials.json'), '{');
    const input = {
      language: 'en-US' as const,
      theme: 'rose-moon' as const,
      providerId: 'deepseek',
      modelIds: ['deepseek-flash'],
      apiKey: 'test-key',
    };
    await useSetupWizardStore.getState().completeSetup(input);
    expect(useSetupWizardStore.getState().status).toBe('error');
    expect(settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { general: { theme: 'rose-moon', setupCompleted: false } } },
    });
    fs.rmSync(path.join(root, 'credentials.json'));
    await useSetupWizardStore.getState().completeSetup(input);
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });
  it('allows setup to finish without selecting a provider', async () => {
    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      modelIds: [],
      skipProvider: true,
    });
    expect(settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { general: { setupCompleted: true }, providers: {} } },
    });
    expect(fs.existsSync(path.join(root, 'credentials.json'))).toBe(false);
  });
});
