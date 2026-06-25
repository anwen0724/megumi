// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return walkSourceFiles(fullPath);
    }

    return sourceExtensions.has(extname(entry.name)) ? [fullPath] : [];
  });
}

function relativePath(filePath: string): string {
  return relative(root, filePath).replaceAll(sep, '/');
}

function sourceUnder(relativeDirectory: string): string {
  return walkSourceFiles(join(root, relativeDirectory))
    .map((file) => `\n// ${relativePath(file)}\n${readFileSync(file, 'utf8')}`)
    .join('\n');
}

describe('agent package boundary', () => {
  it('owns generic Agent Runtime under packages/agent', () => {
    expect(existsSync(join(root, 'packages/agent/loop/agent-loop.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/agent/model/model-step.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/agent/model/model-step-event-adapter.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/agent/model/model-step-provider-adapter.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/agent/ports/model-step-port.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/agent/state/state-policy.ts'))).toBe(true);
  });

  it('does not keep Agent Runtime under packages/core', () => {
    expect(existsSync(join(root, 'packages/core', 'agent-runtime'))).toBe(false);
    expect(existsSync(join(root, 'packages/core/ports/ai-port.ts'))).toBe(false);
  });

  it('keeps packages/agent free of desktop and coding-agent product dependencies', () => {
    const source = sourceUnder('packages/agent');

    expect(source).not.toContain('@megumi/desktop');
    expect(source).not.toContain('apps/desktop');
    expect(source).not.toContain('electron');
    expect(source).not.toContain('BrowserWindow');
    expect(source).not.toContain('ipcMain');
    expect(source).not.toContain('@megumi/coding-agent');
    expect(source).not.toContain('@megumi/coding-agent/input');
    expect(source).not.toContain('@megumi/coding-agent/input/command');
    expect(source).not.toContain('better-sqlite3');
  });

  it('does not introduce sessions or multi-agent in this phase', () => {
    expect(existsSync(join(root, 'packages/agent/sessions'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/session'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/multi-agent'))).toBe(false);
  });
});
