// Verifies the desktop shell resolves packaged Coding Agent migration assets.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopPersistenceMigrationsFolder } from '@megumi/desktop/main/shell/electron-persistence-migrations-host';

describe('resolveDesktopPersistenceMigrationsFolder', () => {
  it('uses source migrations in development', () => {
    expect(resolveDesktopPersistenceMigrationsFolder({
      isPackaged: false,
      cwd: 'C:/repo/megumi',
      resourcesPath: 'C:/repo/megumi/out/Megumi/resources',
    })).toBe(path.resolve('C:/repo/megumi', 'packages/coding-agent/persistence/migrations'));
  });

  it('uses resources/persistence/migrations in packaged runtime', () => {
    expect(resolveDesktopPersistenceMigrationsFolder({
      isPackaged: true,
      cwd: 'C:/repo/megumi',
      resourcesPath: 'C:/Users/anwen/AppData/Local/Megumi/app-0.1.0/resources',
    })).toBe(path.resolve(
      'C:/Users/anwen/AppData/Local/Megumi/app-0.1.0/resources',
      'persistence/migrations',
    ));
  });
});
