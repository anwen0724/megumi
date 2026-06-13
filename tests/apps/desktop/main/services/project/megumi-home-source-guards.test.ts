// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function projectFileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function term(...parts: string[]): string {
  return parts.join('');
}

describe('Megumi Home source guards', () => {
  it('keeps database creation on Megumi Home sqlite path in main composition', () => {
    const source = readProjectFile('apps/desktop/src/main/index.ts');
    const singleQuotedUserData = term("app.getPath('", 'userData', "')");
    const doubleQuotedUserData = term('app.getPath("', 'userData', '")');

    expect(source).toContain('initializeElectronMegumiHomeSync');
    expect(source).toContain("path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3')");
    expect(source).not.toContain(`createDatabase(path.join(${singleQuotedUserData}, 'megumi.sqlite3'))`);
    expect(source).not.toContain(`createDatabase(path.join(${doubleQuotedUserData}, "megumi.sqlite3"))`);
  });

  it('does not use Electron userData as an automatic migration source in provider handler', () => {
    const source = readProjectFile('apps/desktop/src/main/ipc/handlers/provider.handler.ts');
    const userDataMatches = source.match(new RegExp(term('app\\.getPath\\([\'"]', 'userData', '[\'"]\\)'), 'g')) ?? [];

    expect(userDataMatches).toEqual([]);
    expect(source).not.toContain(term('legacy', 'UserDataPath'));
  });

  it('keeps provider credentials in Megumi Home settings.json instead of secret-store files', () => {
    const homeSource = readProjectFile('apps/desktop/src/main/services/project/megumi-home.service.ts');
    const providerSettingsSource = readProjectFile('apps/desktop/src/main/services/provider/provider-settings.service.ts');

    expect(projectFileExists('apps/desktop/src/main/services/security/secret-store.service.ts')).toBe(false);
    expect(homeSource).toContain('settings.json');
    expect(homeSource).toContain('settings.schema.json');
    expect(providerSettingsSource).toContain('setProviderApiKey');
    expect(providerSettingsSource).toContain('apiKey');
  });

  it('uses Megumi Home settings when constructing provider runtime services', () => {
    const providerHandler = readProjectFile('apps/desktop/src/main/ipc/handlers/provider.handler.ts');
    const mainComposition = readProjectFile('apps/desktop/src/main/index.ts');

    expect(providerHandler).toContain('createAppSettingsService');
    expect(providerHandler).toContain('settingsPath: homePaths.settingsPath');
    expect(mainComposition).toContain('new ProviderSettingsService');
    expect(mainComposition).toContain('new ProviderRuntimeService');
    expect(mainComposition).not.toContain('createElectronSecretStoreService');
  });

  it('does not expose plaintext API keys through main-to-renderer send calls', () => {
    const mainSources = [
      'apps/desktop/src/main/ipc/handlers/provider.handler.ts',
      'apps/desktop/src/main/ipc/handlers/session.handler.ts',
      'apps/desktop/src/main/services/provider/provider-settings.service.ts',
      'apps/desktop/src/main/services/provider/provider-runtime.service.ts',
    ]
      .map(readProjectFile)
      .join('\n');

    expect(mainSources).not.toMatch(/send\(.*apiKey/i);
    expect(mainSources).not.toMatch(/apiKey.*send\(/i);
    expect(mainSources).not.toMatch(/secret.*send\(/i);
  });

  it('does not register legacy AI IPC handlers', () => {
    const source = readProjectFile('apps/desktop/src/main/ipc/register-handlers.ts');
    const legacyRegistrations = [
      'register' + 'AIHandlers',
    ];

    for (const registration of legacyRegistrations) {
      expect(source).not.toContain(registration);
    }

    expect(source).not.toContain('./handlers/ai.handler');
    expect(source).toContain('./handlers/settings.handler');
    expect(source).toContain('settingsService?: SettingsHandlersService');
  });

  it('removes the old Electron userData credential runtime files', () => {
    const oldRuntimeFiles = [
      'apps/desktop/src/main/ipc/handlers/ai.handler.ts',
      'apps/desktop/src/main/services/key-' + 'store.service.ts',
    ];

    for (const file of oldRuntimeFiles) {
      expect(projectFileExists(file), file).toBe(false);
    }
  });
});

