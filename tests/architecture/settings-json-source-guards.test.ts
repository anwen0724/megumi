import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();

function productionFilesUnder(...segments: string[]): string[] {
  const start = join(repoRoot, ...segments);
  const files: string[] = [];
  if (!existsSync(start)) {
    return files;
  }

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.vite') continue;
        walk(fullPath);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
        files.push(fullPath);
      }
    }
  }

  walk(start);
  return files;
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(repoRoot, file).replace(/\\/g, '/'));
}

describe('settings.json source guards', () => {
  it('keeps Megumi Home user configuration on settings.json instead of config.json', () => {
    const mainFiles = productionFilesUnder('apps', 'desktop', 'src', 'main');

    expect(offenders(mainFiles, /\bconfigPath\b|config\.json|config\.schema\.json|MegumiHomeConfigService|MegumiHomeConfigParseError/)).toEqual([]);
    expect(offenders(mainFiles, /settingsPath|settings\.json|AppSettingsService/)).not.toEqual([]);
  });

  it('keeps provider credentials in settings.json and removes provider secret-store wiring', () => {
    const mainProviderFiles = [
      ...productionFilesUnder('apps', 'desktop', 'src', 'main', 'services', 'provider'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main', 'ipc', 'handlers'),
      join(repoRoot, 'apps', 'desktop', 'src', 'main', 'index.ts'),
    ];

    expect(offenders(mainProviderFiles, /secretRef|SecretRef|secret-store|safeStorage|createElectronSecretStoreService|buildProviderApiKeySecretRef/)).toEqual([]);
  });

  it('does not create DB-backed provider or memory settings tables', () => {
    const dbFiles = [
      ...productionFilesUnder('packages', 'db'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main'),
    ];

    expect(offenders(dbFiles, /\bprovider_settings\b|\bmemory_settings\b|getSettings\(\): MemorySettings|saveSettings\(settings: MemorySettings/)).toEqual([]);
  });

  it('does not expose legacy memory settings IPC', () => {
    const files = [
      ...productionFilesUnder('packages', 'shared'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'preload'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'renderer'),
      ...productionFilesUnder('apps', 'desktop', 'src', 'main', 'ipc'),
    ];

    expect(offenders(files, /memory:settings:get|memory:settings:update|MemorySettingsGet|MemorySettingsUpdate|settingsGet|settingsUpdate/)).toEqual([]);
  });
});
