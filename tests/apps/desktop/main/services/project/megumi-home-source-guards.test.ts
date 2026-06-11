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
  it('keeps provider handler database creation on Megumi Home sqlite path', () => {
    const source = readProjectFile('apps/desktop/src/main/ipc/handlers/provider.handler.ts');
    const singleQuotedUserData = term("app.getPath('", 'userData', "')");
    const doubleQuotedUserData = term('app.getPath("', 'userData', '")');

    expect(source).toContain('initializeElectronMegumiHomeSync');
    expect(source).toContain("path.join(homePaths.sqlitePath, 'megumi.sqlite3')");
    expect(source).not.toContain(`createDatabase(path.join(${singleQuotedUserData}, 'megumi.sqlite3'))`);
    expect(source).not.toContain(`createDatabase(path.join(${doubleQuotedUserData}, "megumi.sqlite3"))`);
  });

  it('does not use Electron userData as an automatic migration source in provider handler', () => {
    const source = readProjectFile('apps/desktop/src/main/ipc/handlers/provider.handler.ts');
    const userDataMatches = source.match(new RegExp(term('app\\.getPath\\([\'"]', 'userData', '[\'"]\\)'), 'g')) ?? [];

    expect(userDataMatches).toEqual([]);
    expect(source).not.toContain(term('legacy', 'UserDataPath'));
  });

  it('creates provider encrypted secret files under secrets/providers', () => {
    const source = readProjectFile('apps/desktop/src/main/services/security/secret-store.service.ts');

    expect(source).toContain("'providers'");
    expect(source).toContain('`${ref.providerId}.enc`');
    expect(source).not.toContain(term("app.getPath('", 'userData', "')"));
    expect(source).not.toContain(term('app.getPath("', 'userData', '")'));
    expect(source).not.toContain(
      "path.join(this.options.userDataPath, 'secrets', `${this.sanitizeSecretId(ref.id)}.enc`)",
    );
  });

  it('uses Megumi Home root when constructing provider and model step secret stores', () => {
    const providerHandler = readProjectFile('apps/desktop/src/main/ipc/handlers/provider.handler.ts');
    const mainComposition = readProjectFile('apps/desktop/src/main/index.ts');

    expect(providerHandler).toContain('createElectronSecretStoreService(homePaths.homePath)');
    expect(mainComposition).toContain('createElectronSecretStoreService(megumiHomePaths.homePath)');
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

  it('does not register legacy AI or settings IPC handlers', () => {
    const source = readProjectFile('apps/desktop/src/main/ipc/register-handlers.ts');
    const legacyRegistrations = [
      'register' + 'AIHandlers',
      'register' + 'SettingsHandlers',
    ];

    for (const registration of legacyRegistrations) {
      expect(source).not.toContain(registration);
    }

    expect(source).not.toContain('./handlers/ai.handler');
    expect(source).not.toContain('./handlers/settings.handler');
  });

  it('removes the old Electron userData credential runtime files', () => {
    const oldRuntimeFiles = [
      'apps/desktop/src/main/ipc/handlers/ai.handler.ts',
      'apps/desktop/src/main/ipc/handlers/settings.handler.ts',
      'apps/desktop/src/main/services/key-' + 'store.service.ts',
    ];

    for (const file of oldRuntimeFiles) {
      expect(projectFileExists(file), file).toBe(false);
    }
  });
});

