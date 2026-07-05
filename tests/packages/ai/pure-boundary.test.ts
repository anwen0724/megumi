// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pure AI package boundary', () => {
  it('keeps runtime and desktop concepts out of pure AI files', () => {
    const violations = listTypeScriptFiles(join(process.cwd(), 'packages/ai')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const forbidden = [
        '@megumi/coding-agent/events',
        'RuntimeEvent',
        'RuntimeError',
        'ModelStepRuntimeRequest',
        'createRuntimeEvent',
        'createRunFailedEvent',
        'createToolCallCreatedEvent',
        'sessionId:',
        'runId:',
        'stepId:',
        '@megumi/desktop',
        'electron',
        'BrowserWindow',
        'ipcMain',
        'better-sqlite3',
      ].filter((pattern) => source.includes(pattern));

      return forbidden.map((pattern) => `${relative(process.cwd(), path)} contains ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps runtime compatibility outside packages/ai', () => {
    expect(existsSync(join(process.cwd(), 'packages/ai', 'compat'))).toBe(false);
  });
});

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}
