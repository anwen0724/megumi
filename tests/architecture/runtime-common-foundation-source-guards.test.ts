// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const projectRoot = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function projectPath(path: string): string {
  return join(projectRoot, path);
}

function readProjectFile(path: string): string {
  return readFileSync(projectPath(path), 'utf8');
}

function listSourceFiles(path: string): string[] {
  const root = projectPath(path);

  if (!existsSync(root)) {
    return [];
  }

  const output: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.vite') {
          continue;
        }
        visit(fullPath);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const dotIndex = entry.lastIndexOf('.');
      const extension = dotIndex >= 0 ? entry.slice(dotIndex) : '';

      if (SOURCE_EXTENSIONS.has(extension)) {
        output.push(relative(projectRoot, fullPath).replace(/\\/g, '/'));
      }
    }
  };

  visit(root);
  return output.sort();
}

function sourceHits(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) => {
    const text = readProjectFile(file);
    return pattern.test(text) ? [file] : [];
  });
}

const packageSourceFiles = listSourceFiles('packages');
const desktopSourceFiles = listSourceFiles('apps/desktop/src');
const sourceFiles = [...packageSourceFiles, ...desktopSourceFiles];
const oldBridgeNamePattern = new RegExp(`\\b${['dev', 'flow'].join('')}\\b`);
const obsoleteRuntimeErrorFieldPattern = new RegExp(`\\b${['recover', 'able'].join('')}\\b`);

describe('Runtime Common Foundation source guards', () => {
  it('keeps RuntimeError on severity and retryable fields without obsolete aliases', () => {
    const runtimeErrorsSource = readProjectFile('packages/shared/runtime-errors.ts');

    expect(runtimeErrorsSource).toContain('severity');
    expect(runtimeErrorsSource).toContain('retryable');
    expect(sourceHits(sourceFiles, obsoleteRuntimeErrorFieldPattern)).toEqual([]);
  });

  it('keeps runtime event names and channel stable', () => {
    const runtimeEventsSource = readProjectFile('packages/shared/runtime-events.ts');
    const ipcChannelsSource = readProjectFile('packages/shared/ipc-channels.ts');

    expect(runtimeEventsSource).toContain("'run.started'");
    expect(runtimeEventsSource).toContain("'assistant.output.delta'");
    expect(runtimeEventsSource).toContain('eventType');
    expect(runtimeEventsSource).toContain('eventId');
    expect(runtimeEventsSource).toContain('context?: RuntimeContext');
    expect(ipcChannelsSource).toContain('runtime:event');
    expect(sourceHits(sourceFiles, /chat:stream-event/)).toEqual([]);
  });

  it('routes runtime event delivery through the main forwarder only', () => {
    const mainFiles = listSourceFiles('apps/desktop/src/main');
    const directRuntimeEventSenders = mainFiles.filter((file) => {
      if (file === 'apps/desktop/src/main/ipc/runtime-event-forwarder.ts') {
        return false;
      }

      const text = readProjectFile(file);
      return text.includes('IPC_CHANNELS.runtime.event');
    });

    expect(directRuntimeEventSenders).toEqual([]);
  });

  it('does not wrap window controls in business runtime IPC envelopes', () => {
    const windowHandlerSource = readProjectFile('apps/desktop/src/main/ipc/handlers/window.handler.ts');

    expect(windowHandlerSource).toContain('IPC_CHANNELS.window');
    expect(windowHandlerSource).not.toContain('createRuntimeIpcHandler');
    expect(windowHandlerSource).not.toContain('RuntimeIpcRequest');
    expect(windowHandlerSource).not.toContain('RuntimeIpcResult');
  });

  it('keeps the preload bridge name on window.megumi', () => {
    const preloadIndexSource = readProjectFile('apps/desktop/src/preload/index.ts');

    expect(preloadIndexSource).toContain("contextBridge.exposeInMainWorld('megumi'");
    expect(sourceHits(desktopSourceFiles, oldBridgeNamePattern)).toEqual([]);
  });

  it('keeps packages/shared independent from other Megumi packages', () => {
    const sharedFiles = listSourceFiles('packages/shared');
    const invalidImports = sharedFiles.filter((file) => {
      const text = readProjectFile(file);
      return /from ['"]@megumi\/(?!shared\b)[^'"]+['"]/.test(text)
        || /from ['"]\.\.\/(core|ai|tools|memory|db|security)[^'"]*['"]/.test(text);
    });

    expect(invalidImports).toEqual([]);
  });

  it('keeps packages/core free from platform and service implementations', () => {
    const coreFiles = listSourceFiles('packages/core');
    const invalidImports = coreFiles.filter((file) => {
      const text = readProjectFile(file);
      return /from ['"](@megumi\/(ai|security|db|desktop|tools|memory)|electron|better-sqlite3)[^'"]*['"]/.test(text);
    });

    expect(invalidImports).toEqual([]);
  });

  it('keeps renderer-facing runtime boundary code from exposing raw stack or raw cause', () => {
    const boundaryFiles = [
      'apps/desktop/src/main/ipc/runtime-ipc-handler.ts',
      'apps/desktop/src/main/ipc/runtime-event-forwarder.ts',
      'apps/desktop/src/main/app/runtime-process-errors.ts',
      'apps/desktop/src/preload/api.ts',
      'apps/desktop/src/renderer/shared/ipc/runtime-result.ts',
    ].filter((file) => existsSync(projectPath(file)));

    const rawStackOrCauseHits = boundaryFiles.filter((file) => {
      const text = readProjectFile(file);
      return /error\.stack|error\.cause|String\(error\)|String\(reason\)/.test(text);
    });

    expect(rawStackOrCauseHits).toEqual([]);
  });

  it('keeps business IPC handlers on createRuntimeIpcHandler', () => {
    const handlerFiles = listSourceFiles('apps/desktop/src/main/ipc/handlers')
      .filter((file) => !file.endsWith('window.handler.ts'));
    const handlersWithoutAdapter = handlerFiles.filter((file) => {
      const text = readProjectFile(file);
      return text.includes('ipcMain.handle(') && !text.includes('createRuntimeIpcHandler');
    });

    expect(handlersWithoutAdapter).toEqual([]);
  });
});
