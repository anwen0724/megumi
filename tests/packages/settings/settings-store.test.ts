/* Verifies local settings.json compatibility, atomic writes, and stable parse failures. */
// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createSettings,
} from '../../../packages/settings/src';
import {
  SettingsStoreParseError,
  createSettingsStore,
} from '@megumi/settings/store';

describe('settings.json store', () => {
  let temporaryHome: string | undefined;

  afterEach(async () => {
    if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
    temporaryHome = undefined;
  });

  async function createFixture() {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-settings-'));
    const settingsPath = path.join(temporaryHome, 'settings.json');
    const store = createSettingsStore({ settingsPath });
    const settings = createSettings({ store });
    return { settings, settingsPath, store };
  }

  it('returns defaults when settings.json is missing', async () => {
    const { settings } = await createFixture();
    const resolved = settings.resolve();
    expect(resolved.status).toBe('ok');
    if (resolved.status !== 'ok') return;
    expect(resolved.settings).toEqual(DEFAULT_SETTINGS);
    const read = settings.read();
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.settings).toEqual({});
  });

  it('merges partial raw settings with defaults', async () => {
    const { settings, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      theme: 'sage-mist',
      memory: { enabled: true },
    }), 'utf8');
    const resolved = settings.resolve();
    expect(resolved.status).toBe('ok');
    if (resolved.status !== 'ok') return;
    expect(resolved.settings).toMatchObject({
      theme: 'sage-mist',
      memory: { enabled: true },
    });
  });

  it('atomically writes materialized settings without leaving temporary files', async () => {
    const { settings, settingsPath } = await createFixture();
    expect(settings.update({ patch: { theme: 'graphite-dark' } })).toMatchObject({ status: 'updated' });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      context: { compaction_threshold_ratio: 0.8 },
      theme: 'graphite-dark',
    });
    expect(await readdir(path.dirname(settingsPath))).toEqual(['settings.json']);
  });

  it('keeps keys in settings.json while ordinary reads and updates remain secret-free', async () => {
    const { settings, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      providers: { deepseek: { api_key: 'provider-secret' } },
      web: { search: { provider: 'tavily', api_key: 'web-secret' } },
    }), 'utf8');

    expect(JSON.stringify(settings.read())).not.toContain('provider-secret');
    expect(JSON.stringify(settings.resolve())).not.toContain('web-secret');
    expect(settings.update({ patch: { theme: 'sage-mist' } })).toMatchObject({ status: 'updated' });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      theme: 'sage-mist',
      providers: { deepseek: { api_key: 'provider-secret' } },
      web: { search: { provider: 'tavily', api_key: 'web-secret' } },
    });

    expect(settings.deleteProviderApiKey({ provider_id: 'deepseek' })).toEqual({ status: 'deleted' });
    expect(settings.deleteWebSearchApiKey({})).toEqual({ status: 'deleted' });
    const deleted = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(deleted.providers.deepseek).not.toHaveProperty('api_key');
    expect(deleted.web.search).not.toHaveProperty('api_key');
  });

  it('creates settings.json when setup is completed', async () => {
    const { settings, settingsPath } = await createFixture();
    settings.update({ patch: {
      language: 'zh-CN',
      theme: 'sage-mist',
      setup: { completed: true, completed_at: '2026-06-29T12:00:00.000Z' },
    } });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      context: { compaction_threshold_ratio: 0.8 },
      language: 'zh-CN',
      theme: 'sage-mist',
      setup: { completed: true, completed_at: '2026-06-29T12:00:00.000Z' },
    });
  });

  it('drops obsolete compaction settings during compatibility parsing', async () => {
    const { settings, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      compaction: { reserve_tokens: 32768 },
    }), 'utf8');
    expect(settings.update({ patch: { memory: { enabled: true } } })).toMatchObject({ status: 'updated' });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      context: { compaction_threshold_ratio: 0.8 },
      memory: { enabled: true },
    });
  });

  it('migrates legacy provider protocol and models array and persists the normalized file', async () => {
    const { store, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      providers: {
        deepseek: { protocol: 'openai-compatible', models: ['deepseek-chat'] },
      },
    }), 'utf8');
    expect(store.read()).toMatchObject({
      providers: { deepseek: { api: 'openai-completions', models: { 'deepseek-chat': {} } } },
    });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      providers: { deepseek: { api: 'openai-completions', models: { 'deepseek-chat': {} } } },
    });
  });

  it('migrates the legacy AppSettings shape to the settings.json file model', async () => {
    const { store, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      language: 'zh-CN',
      providers: {
        anthropic: { enabled: true, protocol: 'anthropic', displayName: 'Anthropic', apiKey: 'sk-test' },
      },
    }), 'utf8');
    expect(store.read()).toMatchObject({
      language: 'zh-CN',
      providers: {
        anthropic: {
          enabled: true,
          api: 'anthropic-messages',
          display_name: 'Anthropic',
          api_key: 'sk-test',
        },
      },
    });
  });

  it('leaves already normalized settings.json untouched', async () => {
    const { store, settingsPath } = await createFixture();
    await writeFile(settingsPath, JSON.stringify({
      theme: 'sage-mist',
      providers: { deepseek: { enabled: true, api: 'openai-completions' } },
    }), 'utf8');
    expect(store.read()).toMatchObject({ theme: 'sage-mist' });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      theme: 'sage-mist',
      providers: { deepseek: { enabled: true, api: 'openai-completions' } },
    });
  });

  it('does not overwrite invalid JSON and reports a stable parse error', async () => {
    const { settings, settingsPath, store } = await createFixture();
    await writeFile(settingsPath, '{', 'utf8');
    const result = settings.resolve();
    expect(result).toMatchObject({ status: 'failed', failure: { retryable: false } });
    expect(() => store.read()).toThrow(SettingsStoreParseError);
    expect(await readFile(settingsPath, 'utf8')).toBe('{');
  });
});
