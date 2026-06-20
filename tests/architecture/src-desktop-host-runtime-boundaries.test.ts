// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walkFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];

  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path.relative(root, fullPath).replaceAll(path.sep, '/')));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(path.relative(root, fullPath).replaceAll(path.sep, '/'));
    }
  }

  return files;
}

function findMatches(files: string[], patterns: RegExp[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const source = read(file);
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        violations.push(`${file} matches ${pattern}`);
      }
    }
  }
  return violations;
}

describe('src desktop host runtime boundaries', () => {
  it('keeps desktop directories aligned with host architecture names', () => {
    const forbiddenDirectories = [
      'src/desktop/dto',
      'src/desktop/mappers',
      'src/desktop/services/timeline-history-commit-projector.ts',
    ];

    for (const directory of forbiddenDirectories) {
      expect(fs.existsSync(path.join(root, directory))).toBe(false);
    }

    const requiredDirectories = [
      'src/desktop/preload',
      'src/desktop/ipc/handlers',
      'src/desktop/ipc/events',
      'src/desktop/renderer-protocol/chat-stream',
      'src/desktop/renderer-protocol/runtime',
      'src/desktop/renderer-protocol/request',
      'src/desktop/renderer-protocol/response',
      'src/desktop/renderer-protocol/timeline',
      'src/desktop/renderer-protocol/productization',
      'src/desktop/services',
      'src/desktop/composition',
      'src/desktop/infrastructure',
      'src/desktop/hosts',
      'src/desktop/window',
    ];

    for (const directory of requiredDirectories) {
      expect(fs.existsSync(path.join(root, directory))).toBe(true);
    }
  });

  it('keeps app as a thin adapter without desktop, Electron, UI, or owner module implementation imports', () => {
    expect(findMatches(walkFiles('src/app'), [
      /from ['"]electron['"]/,
      /from ['"]react['"]/,
      /from ['"]\.\.\/desktop(?:\/|['"])/,
      /from ['"]\.\.\/ui(?:\/|['"])/,
      /from ['"]\.\.\/input(?:\/|['"])/,
      /from ['"]\.\.\/command(?:\/|['"])/,
      /from ['"]\.\.\/context(?:\/|['"])/,
      /from ['"]\.\.\/ai(?:\/|['"])/,
      /from ['"]\.\.\/tools(?:\/|['"])/,
      /from ['"]\.\.\/permission(?:\/|['"])/,
      /from ['"]\.\.\/workspace(?:\/|['"])/,
      /from ['"]\.\.\/database(?:\/|['"])/,
      /createLocalDesktopRuntime/,
      /createAgentRunner/,
      /parseRawInput/,
      /buildModelContextInput/,
      /streamAssistantMessage/,
      /preflightToolCall/,
      /evaluatePermissionPolicy/,
    ])).toEqual([]);
  });

  it('keeps desktop event mappers and forwarders as projection code, not Agent Loop owners', () => {
    expect(findMatches([
      ...walkFiles('src/desktop/renderer-protocol'),
      'src/desktop/ipc/chat-stream-event-forwarder.ts',
      'src/desktop/ipc/runtime-event-forwarder.ts',
    ], [
      /createAgentRunner/,
      /parseRawInput/,
      /buildModelContextInput/,
      /streamAssistantMessage/,
      /preflightToolCall/,
      /evaluatePermissionPolicy/,
      /createSessionStateManager/,
      /openSqliteDatabase/,
      /runDatabaseMigrations/,
    ])).toEqual([]);
  });

  it('keeps the final Electron/Vite/Forge entrypoints on src after Plan 6', () => {
    expect(read('forge.config.ts')).toContain('src/desktop/main.ts');
    expect(read('forge.config.ts')).toContain('src/desktop/preload/index.ts');
    expect(read('vite.renderer.config.ts')).toContain("root: 'src/ui'");
    expect(read('forge.config.ts')).not.toContain('apps/desktop/src/main/index.ts');
    expect(read('forge.config.ts')).not.toContain('apps/desktop/src/preload/index.ts');
    expect(read('vite.renderer.config.ts')).not.toContain("root: 'apps/desktop/src/renderer'");
  });
});
