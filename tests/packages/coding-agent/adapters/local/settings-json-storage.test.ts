// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalSettingsJsonStorage, LocalSettingsJsonParseError } from '@megumi/coding-agent/adapters/local';
import { createSettingsService, DEFAULT_SETTINGS } from '@megumi/coding-agent/settings';

describe('Local settings.json storage', () => {
  let temporaryHome: string | undefined;

  afterEach(async () => {
    if (temporaryHome) {
      await rm(temporaryHome, { recursive: true, force: true });
      temporaryHome = undefined;
    }
  });

  async function createService() {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-local-settings-'));
    const settingsPath = path.join(temporaryHome, 'settings.json');
    const service = createSettingsService({
      file_store: createLocalSettingsJsonStorage({ settingsPath }),
    });
    return { service, settingsPath };
  }

  it('returns resolved defaults when settings.json is missing', async () => {
    const { service } = await createService();

    expect(service.getResolvedSettings()).toEqual({ status: 'ok', settings: DEFAULT_SETTINGS });
    expect(service.getRawSettings()).toEqual({ status: 'ok', settings: {} });
  });

  it('merges partial raw settings with defaults', async () => {
    const { service, settingsPath } = await createService();
    await writeFile(settingsPath, JSON.stringify({
      theme: 'sage-mist',
      memory: {
        enabled: true,
      },
    }), 'utf8');

    expect(service.getResolvedSettings()).toMatchObject({
      status: 'ok',
      settings: {
        theme: 'sage-mist',
        memory: {
          enabled: true,
        },
      },
    });
  });

  it('writes only raw user overrides when updating one setting', async () => {
    const { service, settingsPath } = await createService();

    expect(service.updateSettings({ patch: { theme: 'graphite-dark' } })).toMatchObject({
      status: 'updated',
      settings: {
        theme: 'graphite-dark',
      },
    });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      theme: 'graphite-dark',
    });
  });

  it('creates settings.json when setup completion is written for the first time', async () => {
    const { service, settingsPath } = await createService();

    service.updateSettings({
      patch: {
        language: 'zh-CN',
        theme: 'sage-mist',
        setup: {
          completed: true,
          completed_at: '2026-06-29T12:00:00.000Z',
        },
      },
    });

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      language: 'zh-CN',
      theme: 'sage-mist',
      setup: {
        completed: true,
        completed_at: '2026-06-29T12:00:00.000Z',
      },
    });
  });

  it('patches nested raw settings without expanding defaults into the file', async () => {
    const { service, settingsPath } = await createService();
    await writeFile(settingsPath, JSON.stringify({
      compaction: {
        reserve_tokens: 32768,
      },
    }), 'utf8');

    service.updateSettings({
      patch: {
        memory: {
          enabled: true,
        },
      },
    });

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      compaction: {
        reserve_tokens: 32768,
      },
      memory: {
        enabled: true,
      },
    });
    expect(service.getResolvedSettings()).toMatchObject({
      status: 'ok',
      settings: {
        memory: {
          enabled: true,
        },
        compaction: {
          reserve_tokens: 32768,
        },
      },
    });
  });

  it('reports the settings path when settings.json is invalid', async () => {
    const { service, settingsPath } = await createService();
    await writeFile(settingsPath, '{', 'utf8');

    const result = service.getResolvedSettings();
    expect(result.status).toBe('failed');
    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'settings_raw_invalid',
      },
    });
    expect(() => createLocalSettingsJsonStorage({ settingsPath }).readRawSettings())
      .toThrow(LocalSettingsJsonParseError);
  });
});
