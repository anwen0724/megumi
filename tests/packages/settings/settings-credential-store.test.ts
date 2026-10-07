/* Verifies separate credential persistence through the public Settings operations. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSettings } from '@megumi/application/settings/settings-store';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(environment: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-credentials-'));
  directories.push(directory);
  const credentialsPath = path.join(directory, 'credentials.json');
  const settingsPath = path.join(directory, 'settings.json');
  const settings = createSettings({
    globalSettingsPath: settingsPath,
    credentialsPath,
    readEnvironment: (name) => environment[name],
  });
  return { directory, credentialsPath, settingsPath, settings };
}

describe('Credentials', () => {
  it('keeps recommendation Tavily separate from the Agent web-search key', () => {
    const { settings } = fixture();
    settings.updateCredential({ target: { kind: 'webSearch' }, value: 'agent-key' });
    expect(settings.updateCredential({ target: { kind: 'discoverySource', sourceId: 'tavily' }, value: 'recommendation-key' })).toMatchObject({ status: 'updated' });
    expect(settings.readCredential({ target: { kind: 'discoverySource', sourceId: 'tavily' } })).toMatchObject({ status: 'found', value: 'recommendation-key' });
    expect(settings.readCredential({ target: { kind: 'webSearch' } })).toMatchObject({ status: 'found', value: 'agent-key' });
  });
  it('rejects damaged credentials instead of treating them as missing or overwriting them', () => {
    const files = fixture({ DEFAULT_KEY: 'available' });
    const target = { kind: 'provider', providerId: 'deepseek' } as const;
    const damaged = '{"providers":{"deepseek":42}}';
    fs.writeFileSync(files.credentialsPath, damaged);
    expect(
      files.settings.readCredential({ target, defaultEnvNames: ['DEFAULT_KEY'] }),
    ).toMatchObject({ status: 'rejected', error: { code: 'CREDENTIAL_FILE_INVALID' } });
    expect(files.settings.updateCredential({ target, value: 'replacement' })).toMatchObject({
      status: 'rejected',
      error: { code: 'CREDENTIAL_FILE_INVALID' },
    });
    expect(fs.readFileSync(files.credentialsPath, 'utf8')).toBe(damaged);
    fs.writeFileSync(files.credentialsPath, '{}');
    expect(files.settings.updateCredential({ target, value: ' ' })).toMatchObject({
      status: 'rejected',
      error: { code: 'CREDENTIAL_INVALID' },
    });
    expect(
      files.settings.readCredential({ target, defaultEnvNames: ['DEFAULT_KEY'] }),
    ).toMatchObject({ status: 'found', value: 'available' });
  });

  it('uses stored values before explicit environment names, and defaults only without an explicit name', () => {
    const files = fixture({ EXPLICIT_KEY: 'explicit', DEFAULT_KEY: 'default' });
    const target = { kind: 'provider', providerId: 'deepseek' } as const;
    expect(
      files.settings.readCredential({ target, defaultEnvNames: ['ABSENT', 'DEFAULT_KEY'] }),
    ).toEqual({ status: 'found', value: 'default', source: 'environment' });
    expect(
      files.settings.readCredential({
        target,
        apiKeyEnv: 'EXPLICIT_KEY',
        defaultEnvNames: ['DEFAULT_KEY'],
      }),
    ).toMatchObject({ status: 'found', value: 'explicit' });
    expect(
      files.settings.readCredential({
        target,
        apiKeyEnv: 'ABSENT',
        defaultEnvNames: ['DEFAULT_KEY'],
      }),
    ).toEqual({ status: 'missing' });
    files.settings.updateCredential({ target, value: 'stored' });
    expect(files.settings.readCredential({ target, apiKeyEnv: 'EXPLICIT_KEY' })).toMatchObject({
      status: 'found',
      value: 'stored',
      source: 'stored',
    });
  });

  it('stores and clears separate targets without creating or disclosing settings secrets', () => {
    const files = fixture();
    const provider = { kind: 'provider', providerId: 'deepseek' } as const;
    expect(files.settings.updateCredential({ target: provider, value: null }).status).toBe(
      'unchanged',
    );
    expect(fs.existsSync(files.credentialsPath)).toBe(false);
    expect(
      files.settings.updateCredential({ target: provider, value: ' first-secret ' }).status,
    ).toBe('updated');
    expect(
      files.settings.updateCredential({ target: { kind: 'webSearch' }, value: 'search-secret' })
        .status,
    ).toBe('updated');
    expect(files.settings.readCredential({ target: provider })).toEqual({
      status: 'found',
      value: 'first-secret',
      source: 'stored',
    });
    expect(
      files.settings.updateCredential({ target: provider, value: 'first-secret' }).status,
    ).toBe('unchanged');
    expect(
      files.settings.updateCredential({ target: provider, value: 'second-secret' }).status,
    ).toBe('updated');
    expect(files.settings.readCredential({ target: provider })).toMatchObject({
      status: 'found',
      value: 'second-secret',
    });
    expect(files.settings.updateCredential({ target: provider, value: null }).status).toBe(
      'updated',
    );
    expect(files.settings.readCredential({ target: provider })).toEqual({ status: 'missing' });
    expect(files.settings.readCredential({ target: { kind: 'webSearch' } })).toMatchObject({
      status: 'found',
      value: 'search-secret',
    });
    expect(JSON.stringify(files.settings.readSettings())).not.toContain('secret');
    expect(fs.existsSync(files.settingsPath)).toBe(false);
  });
});
