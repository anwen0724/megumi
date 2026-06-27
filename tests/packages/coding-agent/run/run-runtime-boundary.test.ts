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
  it('owns model/tool loop runtime under packages/coding-agent/run', () => {
    expect(existsSync(join(root, 'packages/agent'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/run/loop/agent-loop.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-call/model-call-runner.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-call/model-event-adapter.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-call/model-call-contract.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-call/provider-adapter.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/run/lifecycle/run-state-policy.ts'))).toBe(true);
  });

  it('does not keep Agent Runtime under packages/core', () => {
    expect(existsSync(join(root, 'packages/core', 'agent-runtime'))).toBe(false);
    expect(existsSync(join(root, 'packages/core/ports/ai-port.ts'))).toBe(false);
  });

  it('keeps coding-agent run runtime free of desktop and Electron dependencies', () => {
    const source = sourceUnder('packages/coding-agent/run');

    expect(source).not.toContain('@megumi/desktop');
    expect(source).not.toContain('apps/desktop');
    expect(source).not.toContain('electron');
    expect(source).not.toContain('BrowserWindow');
    expect(source).not.toContain('ipcMain');
  });

  it('does not keep session or multi-agent behavior in a top-level agent package', () => {
    expect(existsSync(join(root, 'packages/agent'))).toBe(false);
  });
});
