// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function sourceUnder(relativeDirectory: string): string {
  return walk(join(root, relativeDirectory))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');
}

function relativeProjectPath(filePath: string): string {
  return relative(root, filePath).replaceAll('\\', '/');
}

describe('Desktop Main directory boundaries', () => {
  it('keeps main index as startup wiring instead of service composition', () => {
    const source = read('apps/desktop/src/main/index.ts');

    expect(source).toContain('composeDesktopMain');
    expect(source).toContain('registerAppLifecycle');
    for (const forbidden of [
      '@megumi/db/repos',
      'createDatabase(',
      'new SessionRunService',
      'createToolCallHandlerService',
      'new ProviderRuntimeService',
      'MemoryMarkdownSyncService',
      'WorkspaceRestoreService',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps desktop-main-composition as a compose-module coordinator', () => {
    const source = read('apps/desktop/src/main/composition/desktop-main-composition.ts');

    expect(source).toContain('composeDatabase');
    expect(source).toContain('composeProviderRuntime');
    expect(source).toContain('composeMemoryRuntime');
    expect(source).toContain('composeToolRuntimeFactory');
    expect(source).toContain('composeSessionRuntime');
    expect(source).toContain('composeRecoveryRuntime');
    for (const forbidden of [
      'createDatabase(',
      'new SessionRunService',
      'createToolCallHandlerService',
      'new ProviderRuntimeService',
      'new WorkspaceRestoreService',
      'new TimelineHistoryCommitProjectorService',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps projections independent from renderer, preload, and composition modules', () => {
    const files = walk(join(root, 'apps', 'desktop', 'src', 'main', 'projections'));
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        /from ['"].*renderer/.test(source) ? 'renderer' : '',
        /from ['"].*preload/.test(source) ? 'preload' : '',
        /from ['"].*composition/.test(source) ? 'composition' : '',
        /ipcRenderer/.test(source) ? 'ipcRenderer' : '',
      ]
        .filter(Boolean)
        .map((reason) => `${relativeProjectPath(file)} imports ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps session services from depending on composition modules', () => {
    const files = walk(join(root, 'apps', 'desktop', 'src', 'main', 'services', 'session'));
    const violations = files
      .filter((file) => /from ['"].*composition/.test(readFileSync(file, 'utf8')))
      .map(relativeProjectPath);

    expect(violations).toEqual([]);
  });

  it('keeps renderer away from Desktop Main composition internals', () => {
    const source = sourceUnder('apps/desktop/src/renderer');

    expect(source).not.toContain('main/composition');
    expect(source).not.toContain('composeDesktopMain');
    expect(source).not.toContain('composeSessionRuntime');
  });

  it('keeps Electron and OS capability adapters in app or host instead of services and composition', () => {
    const checkedRoots = [
      join(root, 'apps', 'desktop', 'src', 'main', 'composition'),
      join(root, 'apps', 'desktop', 'src', 'main', 'services'),
      join(root, 'apps', 'desktop', 'src', 'main', 'projections'),
    ];
    const violations = checkedRoots.flatMap((directory) =>
      walk(directory)
        .filter((file) => /from ['"]electron['"]/.test(readFileSync(file, 'utf8')))
        .map(relativeProjectPath),
    );

    expect(violations).toEqual([]);
    expect(read('apps/desktop/src/main/host/electron-dialog-host.ts')).toContain('dialog.showOpenDialog');
    expect(read('apps/desktop/src/main/host/electron-shell-host.ts')).toContain('shell.openPath');
    expect(read('apps/desktop/src/main/host/electron-window-host.ts')).toContain('BrowserWindow.getAllWindows');
  });

  it('keeps IPC handlers from constructing services or importing Electron directly', () => {
    const files = walk(join(root, 'apps', 'desktop', 'src', 'main', 'ipc', 'handlers'));
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        /from ['"]electron['"]/.test(source) ? 'imports electron' : '',
        /initializeElectronMegumiHomeSync/.test(source) ? 'creates Megumi Home paths' : '',
        /createAppSettingsService/.test(source) ? 'creates app settings' : '',
        /new ProviderSettingsService/.test(source) ? 'creates provider settings service' : '',
      ]
        .filter(Boolean)
        .map((reason) => `${relativeProjectPath(file)} ${reason}`);
    });

    expect(violations).toEqual([]);
  });
});
