// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSettingsService, type SettingsRaw } from '@megumi/coding-agent/settings';
import { createSettingsController } from '@megumi/coding-agent/host-interface';

class MemorySettingsFileStore {
  constructor(private raw: SettingsRaw = {}) {}

  readRawSettings(): SettingsRaw {
    return this.raw;
  }

  writeRawSettings(next: SettingsRaw): void {
    this.raw = next;
  }
}

describe('Settings controller', () => {
  it('does not expose plaintext provider API keys in settings payloads', () => {
    const service = createSettingsService({
      file_store: new MemorySettingsFileStore({
        providers: {
          deepseek: {
            api_key: 'sk-secret',
          },
        },
      }),
    });

    const payload = createSettingsController(service).get();

    expect(JSON.stringify(payload)).not.toContain('sk-secret');
    expect(payload.settings.providers.deepseek).not.toHaveProperty('apiKey');
  });
});
