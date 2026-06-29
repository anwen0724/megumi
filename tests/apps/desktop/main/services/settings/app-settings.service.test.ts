// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createAppSettingsService } from '@megumi/desktop/main/services/settings/app-settings.service';
import { DEFAULT_APP_SETTINGS } from '@megumi/shared/settings';

class MemorySettingsFileSystem {
  readonly files = new Map<string, string>();

  readText(filePath: string): string | undefined {
    return this.files.get(filePath);
  }

  writeTextAtomic(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }
}

const settingsPath = path.resolve('C:/Users/anwen/.megumi/settings.json');

describe('AppSettingsService', () => {
  it('returns resolved defaults when settings.json is missing', () => {
    const fileSystem = new MemorySettingsFileSystem();
    const service = createAppSettingsService({
      settingsPath,
      fileSystem,
    });

    expect(service.getResolvedSettings()).toEqual(DEFAULT_APP_SETTINGS);
    expect(service.getRawSettings()).toEqual({});
  });

  it('merges partial raw settings with defaults', () => {
    const fileSystem = new MemorySettingsFileSystem();
    fileSystem.files.set(settingsPath, JSON.stringify({
      theme: 'sage-mist',
      memory: {
        enabled: true,
      },
    }));
    const service = createAppSettingsService({
      settingsPath,
      fileSystem,
    });

    expect(service.getResolvedSettings()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: 'sage-mist',
      memory: {
        enabled: true,
      },
    });
  });

  it('writes only raw user overrides when updating one setting', () => {
    const fileSystem = new MemorySettingsFileSystem();
    const service = createAppSettingsService({
      settingsPath,
      fileSystem,
    });

    expect(service.updateSettings({ theme: 'graphite-dark' })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: 'graphite-dark',
    });
    expect(JSON.parse(fileSystem.files.get(settingsPath) ?? '{}')).toEqual({
      theme: 'graphite-dark',
    });
  });

  it('creates settings.json when setup completion is written for the first time', () => {
    const fileSystem = new MemorySettingsFileSystem();
    const service = createAppSettingsService({
      settingsPath,
      fileSystem,
    });

    service.updateSettings({
      language: 'zh-CN',
      theme: 'sage-mist',
      chat: { defaultProvider: 'deepseek' },
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
      },
    });

    expect(JSON.parse(fileSystem.files.get(settingsPath) ?? '{}')).toEqual({
      language: 'zh-CN',
      theme: 'sage-mist',
      chat: { defaultProvider: 'deepseek' },
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
      },
    });
  });

  it('patches nested raw settings without expanding defaults into the file', () => {
    const fileSystem = new MemorySettingsFileSystem();
    fileSystem.files.set(settingsPath, JSON.stringify({
      compaction: {
        reserveTokens: 32768,
      },
    }));
    const service = createAppSettingsService({
      settingsPath,
      fileSystem,
    });

    service.updateSettings({
      memory: {
        enabled: true,
      },
    });

    expect(JSON.parse(fileSystem.files.get(settingsPath) ?? '{}')).toEqual({
      compaction: {
        reserveTokens: 32768,
      },
      memory: {
        enabled: true,
      },
    });
    expect(service.getResolvedSettings()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      memory: {
        enabled: true,
      },
      compaction: {
        ...DEFAULT_APP_SETTINGS.compaction,
        reserveTokens: 32768,
      },
    });
  });
});
