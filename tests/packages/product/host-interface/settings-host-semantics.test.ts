// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSettings, type SettingsStore } from '@megumi/settings';
import { createSettingsOperations } from '../../../../packages/product/src/operations/settings-operations';

describe('SettingsHost semantics', () => {
  it('forwards updates to Settings and projects the resolved Host DTO', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.update({
      theme: 'midnight-blue',
      modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat' },
    });

    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        theme: 'midnight-blue',
        modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      },
    });
  });

  it('maps renderer audio device settings without leaking Settings file naming', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.update({
      voice: {
        inputDeviceId: 'input-1',
        recognitionLanguage: 'en',
      },
    });

    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        voice: {
          inputDeviceId: 'input-1',
          recognitionLanguage: 'en',
        },
      },
    });
  });

  it('round-trips output device, read-aloud and tts voice settings', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.update({
      voice: {
        outputDeviceId: 'speaker-1',
        readAloudEnabled: true,
        tts: { provider: 'minimax', voiceId: 'qiaopi_mengmei' },
      },
    });

    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        voice: {
          outputDeviceId: 'speaker-1',
          readAloudEnabled: true,
          tts: {
            provider: 'minimax',
            voiceId: 'qiaopi_mengmei',
            hasApiKey: false,
            credentialSource: 'missing',
          },
        },
      },
    });
  });

  it('round-trips renderer-safe daily discovery settings', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.update({
      discovery: {
        conversationRecognitionEnabled: true,
        dailyGenerationTime: '09:30',
        dailyTargetCount: 36,
        enabledSources: ['bilibili', 'open_web'],
      },
    });

    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        discovery: {
          conversationRecognitionEnabled: true,
          dailyGenerationTime: '09:30',
          dailyTargetCount: 36,
          enabledSources: ['bilibili', 'open_web'],
        },
      },
    });
  });

  it('manages the voice tts api key through dedicated host operations', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

    expect(await host.setVoiceTtsApiKey({ apiKey: 'tts-secret' })).toMatchObject({
      status: 'updated',
      tts: { provider: 'minimax', voiceId: 'female-shaonv', hasApiKey: true, credentialSource: 'settings' },
    });

    const result = await host.get();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.settings.voice.tts).toMatchObject({ hasApiKey: true, credentialSource: 'settings' });
    expect(JSON.stringify(result)).not.toContain('tts-secret');

    expect(await host.deleteVoiceTtsApiKey()).toMatchObject({
      status: 'deleted',
      tts: { hasApiKey: false, credentialSource: 'missing' },
    });
    const after = await host.get();
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') return;
    expect(after.settings.voice.tts).toMatchObject({ hasApiKey: false, credentialSource: 'missing' });
  });

  it('keeps provider credentials out of list responses', async () => {
    const store = memoryStore({
      providers: {
        deepseek: {
          enabled: true,
          api: 'openai-completions',
          base_url: 'https://api.example.com/v1',
          models: { 'deepseek-chat': {} },
          api_key: 'secret-value',
        },
      },
    });
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.listProviders();

    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('reports unreadable settings as a structured failure instead of throwing', async () => {
    const host = createSettingsOperations(createSettings({ store: memoryStore({ providers: 'not-an-object' }) }));

    const result = await host.get();

    expect(result).toMatchObject({
      status: 'failed',
      failure: expect.objectContaining({ retryable: false }),
    });
  });

  it('reports unknown file keys as diagnostics on the ok response', async () => {
    const host = createSettingsOperations(createSettings({
      store: memoryStore({
        theme: 'sage-mist',
        custom_field: true,
        providers: { deepseek: { enabled: true, api: 'openai-completions', extra: 1 } },
        web: { search: { provider: 'tavily', note: 'x' } },
      }),
    }));

    const result = await host.get();

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.unknownKeys).toEqual([
      'custom_field',
      'providers.deepseek.extra',
      'web.search.note',
    ]);
  });
});

function memoryStore(initial: Record<string, unknown> = {}): SettingsStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = { ...next }; },
  };
}
