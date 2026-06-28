// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ProductSettingsService } from '@megumi/coding-agent/settings';
import type { AppSettingsRaw } from '@megumi/shared/settings';

class MemorySettingsStorage {
  raw: AppSettingsRaw = {};

  readRawSettings(): AppSettingsRaw {
    return this.raw;
  }

  writeRawSettings(next: AppSettingsRaw): void {
    this.raw = next;
  }
}

describe('ProductSettingsService', () => {
  it('owns sparse raw settings merge and resolved product settings', () => {
    const storage = new MemorySettingsStorage();
    const service = new ProductSettingsService({ storage });

    const resolved = service.updateSettings({
      memory: { enabled: true },
      providers: {
        deepseek: {
          enabled: false,
          defaultModel: 'deepseek-custom',
        },
      },
    });

    expect(storage.raw).toEqual({
      memory: { enabled: true },
      providers: {
        deepseek: {
          enabled: false,
          defaultModel: 'deepseek-custom',
        },
      },
    });
    expect(resolved.memory.enabled).toBe(true);
    expect(resolved.providers.deepseek.enabled).toBe(false);
    expect(resolved.providers.deepseek.defaultModel).toBe('deepseek-custom');
    expect(resolved.providers.openai.enabled).toBe(true);
  });

  it('projects memory settings from resolved product settings', () => {
    const storage = new MemorySettingsStorage();
    const service = new ProductSettingsService({ storage });

    expect(service.getMemorySettings().enabled).toBe(false);

    service.updateSettings({ memory: { enabled: true } });

    expect(service.getMemorySettings()).toEqual({ enabled: true });
  });

  it('projects permission settings as merged user-scope rules for product policy', async () => {
    const storage = new MemorySettingsStorage();
    const service = new ProductSettingsService({ storage });

    service.updateSettings({
      permissions: {
        allow: ['read_file(*)'],
        ask: ['write_file(src/*)'],
        deny: ['run_command(rm*)'],
      },
    });

    await expect(service.loadPermissionSettingsForProject()).resolves.toEqual({
      allow: [{ scope: 'user', pattern: 'read_file(*)' }],
      ask: [{ scope: 'user', pattern: 'write_file(src/*)' }],
      deny: [{ scope: 'user', pattern: 'run_command(rm*)' }],
    });
  });
});
