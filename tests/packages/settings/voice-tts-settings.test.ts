/* Verifies the Voice TTS settings domain: defaults, explicit key lifecycle, and the secret boundary. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createRecordSettingsEnvironment,
  createSettings,
  type SettingsStore,
} from '../../../packages/settings/src';

class MemorySettingsStore implements SettingsStore {
  constructor(public document: unknown = {}) {}

  read(): unknown {
    return structuredClone(this.document);
  }

  write(next: Readonly<Record<string, unknown>>): void {
    this.document = structuredClone(next);
  }
}

describe('Voice TTS settings', () => {
  it('resolves the default minimax voice with a missing credential', () => {
    const settings = createSettings({ store: new MemorySettingsStore() });

    expect(settings.resolveVoiceTts()).toEqual({
      status: 'ok',
      settings: {
        provider: 'minimax',
        voice_id: 'female-shaonv',
        has_api_key: false,
        credential_source: 'missing',
      },
    });
  });

  it('keeps tts keys out of public models while the disk file retains them', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });

    expect(settings.writeVoiceTtsApiKey({ api_key: 'tts-secret' })).toEqual({ status: 'updated' });
    expect(settings.readVoiceTtsApiKey({})).toEqual({
      status: 'found', api_key: 'tts-secret', source: 'settings',
    });
    expect(settings.resolveVoiceTts()).toMatchObject({
      status: 'ok',
      settings: { has_api_key: true, credential_source: 'settings' },
    });
    expect(JSON.stringify(settings.read())).not.toContain('tts-secret');
    expect(JSON.stringify(settings.resolve())).not.toContain('tts-secret');
    expect((store.document as { voice: { tts: { api_key: string } } }).voice.tts.api_key).toBe('tts-secret');

    expect(settings.deleteVoiceTtsApiKey({})).toEqual({ status: 'deleted' });
    expect(settings.readVoiceTtsApiKey({})).toEqual({ status: 'missing' });
  });

  it('falls back to the MINIMAX_API_KEY environment variable', () => {
    const settings = createSettings({
      store: new MemorySettingsStore(),
      environment: createRecordSettingsEnvironment({ MINIMAX_API_KEY: 'env-tts-secret' }),
    });

    expect(settings.readVoiceTtsApiKey({})).toEqual({
      status: 'found', api_key: 'env-tts-secret', source: 'environment', env_name: 'MINIMAX_API_KEY',
    });
    expect(settings.resolveVoiceTts()).toMatchObject({
      status: 'ok',
      settings: { has_api_key: true, credential_source: 'environment' },
    });
  });

  it('honours an explicit api_key_env override', () => {
    const settings = createSettings({
      store: new MemorySettingsStore({ voice: { tts: { api_key_env: 'MY_TTS_KEY' } } }),
      environment: createRecordSettingsEnvironment({ MY_TTS_KEY: 'custom-env-secret' }),
    });

    expect(settings.readVoiceTtsApiKey({})).toMatchObject({
      status: 'found', api_key: 'custom-env-secret', source: 'environment', env_name: 'MY_TTS_KEY',
    });
  });

  it('rejects tts api_key inside ordinary patches but preserves it through sparse updates', () => {
    const store = new MemorySettingsStore({
      voice: { tts: { provider: 'minimax', api_key: 'tts-secret' } },
    });
    const settings = createSettings({ store });

    expect(settings.update({ patch: {
      voice: { tts: { api_key: 'ordinary-must-fail' } },
    } } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'config_invalid', details: { settings_code: 'settings_patch_invalid' } },
    });
    expect(settings.update({ patch: { voice: { read_aloud_enabled: true } } })).toMatchObject({ status: 'updated' });
    expect((store.document as { voice: { tts: { api_key: string } } }).voice.tts.api_key).toBe('tts-secret');
  });

  it('removes a nulled api_key_env when the patch merges', () => {
    const store = new MemorySettingsStore({
      voice: { tts: { api_key_env: 'OLD_KEY' } },
    });
    const settings = createSettings({ store });

    expect(settings.update({ patch: {
      voice: { tts: { api_key_env: null } },
    } })).toMatchObject({ status: 'updated' });
    expect((store.document as { voice: { tts: Record<string, unknown> } }).voice.tts).not.toHaveProperty('api_key_env');
  });
});
