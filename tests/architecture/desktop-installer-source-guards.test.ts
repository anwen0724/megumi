// Guards the desktop installer configuration for unsigned open-source releases.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('desktop installer configuration', () => {
  it('wires the app icon into Electron Forge and the Windows Squirrel installer', () => {
    const forgeConfig = read('forge.config.ts');

    expect(forgeConfig).toContain("icon: 'apps/desktop/assets/app-icon'");
    expect(forgeConfig).toContain("setupIcon: 'apps/desktop/assets/app-icon.ico'");
    expect(forgeConfig).toContain("executableName: 'megumi'");
  });

  it('keeps the first open-source installer unsigned and without auto update wiring', () => {
    const forgeConfig = read('forge.config.ts');
    const packageJson = read('package.json');

    expect(forgeConfig).not.toMatch(/certificateFile|certificatePassword|signWithParams|osxSign|osxNotarize/);
    expect(`${forgeConfig}\n${packageJson}`).not.toMatch(/autoUpdater|electron-updater|update\.electronjs\.org/);
  });
});
