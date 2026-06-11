// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultMegumiConfig } from '@megumi/desktop/main/services/project/megumi-home.service';
import { createPermissionSettingsService } from '@megumi/desktop/main/services/security/permission-settings.service';

describe('PermissionSettingsService', () => {
  it('loads User, Project, and Local permission settings in stable scope order', async () => {
    const files = new Map<string, unknown>([
      [
        'C:/home/.megumi/config.json',
        {
          ...createDefaultMegumiConfig(),
          permissions: { deny: ['run_command(curl *)'] },
        },
      ],
      ['C:/project/.megumi/settings.json', { permissions: { allow: ['run_command(npm test)'] } }],
      ['C:/project/.megumi/settings.local.json', { permissions: { ask: ['run_command(npm install *)'] } }],
    ]);
    const service = createPermissionSettingsService({
      userConfigPath: 'C:/home/.megumi/config.json',
      fileSystem: {
        readJson: async (filePath) => files.get(normalizePath(filePath)),
        pathExists: async (filePath) => files.has(normalizePath(filePath)),
      },
    });

    const settings = await service.loadForProject('C:/project');

    expect(settings).toEqual({
      deny: [{ scope: 'user', pattern: 'run_command(curl *)' }],
      allow: [{ scope: 'project', pattern: 'run_command(npm test)' }],
      ask: [{ scope: 'local', pattern: 'run_command(npm install *)' }],
    });
  });

  it('ignores missing settings files but rejects malformed existing settings', async () => {
    const files = new Map<string, unknown>([
      ['C:/project/.megumi/settings.local.json', { permissions: { allow: ['invalid pattern'] } }],
    ]);
    const service = createPermissionSettingsService({
      userConfigPath: 'C:/home/.megumi/config.json',
      fileSystem: {
        readJson: async (filePath) => files.get(normalizePath(filePath)),
        pathExists: async (filePath) => files.has(normalizePath(filePath)),
      },
    });

    await expect(service.loadForProject('C:/project')).rejects.toThrow(/Permission rule/);
  });

  it('rejects malformed user permissions from the broader Megumi Home config', async () => {
    const files = new Map<string, unknown>([
      [
        'C:/home/.megumi/config.json',
        {
          ...createDefaultMegumiConfig(),
          permissions: { allow: ['invalid pattern'] },
        },
      ],
    ]);
    const service = createPermissionSettingsService({
      userConfigPath: 'C:/home/.megumi/config.json',
      fileSystem: {
        readJson: async (filePath) => files.get(normalizePath(filePath)),
        pathExists: async (filePath) => files.has(normalizePath(filePath)),
      },
    });

    await expect(service.loadForProject('C:/project')).rejects.toThrow(/Permission rule/);
  });
});

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

