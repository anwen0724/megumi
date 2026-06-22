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

describe('coding-agent package boundary', () => {
  it('exists as the Megumi Coding Agent product-core package', () => {
    expect(existsSync(join(root, 'packages/coding-agent/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/model-step-input-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/model-step-input-build.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/session-compaction-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context-input.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/input-facts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/run-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-step-stream.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/event-utils.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/ports/index.ts'))).toBe(true);
  });

  it('keeps run orchestration in coding-agent instead of desktop session service', () => {
    const codingAgentRun = sourceUnder('packages/coding-agent/run');
    const desktopSessionRun = readFileSync(
      join(root, 'apps/desktop/src/main/services/session/session-run.service.ts'),
      'utf8',
    );

    expect(codingAgentRun).toContain('class CodingAgentRunOrchestrator');
    expect(codingAgentRun).toContain('runModelToolLoop');
    expect(codingAgentRun).toContain('buildContinuationInputContext');
    expect(codingAgentRun).toContain('createCodingAgentRunInputFacts');
    expect(desktopSessionRun).toContain('new CodingAgentRunOrchestrator');
    expect(desktopSessionRun).not.toContain("contextKind: 'compaction-probe'");
    expect(desktopSessionRun).not.toContain("contextKind: 'initial'");
  });

  it('keeps product core free of desktop, Electron, and concrete SQLite dependencies', () => {
    const source = sourceUnder('packages/coding-agent');

    expect(source).not.toContain('@megumi/desktop');
    expect(source).not.toContain('apps/desktop');
    expect(source).not.toContain("from 'electron'");
    expect(source).not.toContain('BrowserWindow');
    expect(source).not.toContain('ipcMain');
    expect(source).not.toContain('@megumi/db');
    expect(source).not.toContain('better-sqlite3');
    expect(source).not.toContain('@megumi/core');
  });

  it('does not place sessions or multi-agent behavior under packages/agent', () => {
    expect(existsSync(join(root, 'packages/agent/session'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/sessions'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/multi-agent'))).toBe(false);
  });

  it('keeps context-management as compatibility re-export files only', () => {
    const compatibilityFiles = [
      'packages/context-management/index.ts',
      'packages/context-management/context-budget.ts',
      'packages/context-management/model-input-context-builder.ts',
      'packages/context-management/model-step-input-context.ts',
      'packages/context-management/session-context.ts',
      'packages/context-management/session-compaction.ts',
    ];

    for (const file of compatibilityFiles) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).toContain('Deprecated compatibility exports');
      expect(source).toMatch(/export \* from ['"]@megumi\/coding-agent\/(context|session)/);
      expect(source).not.toMatch(/\bexport function\b/);
      expect(source).not.toMatch(/\bexport class\b/);
      expect(source).not.toMatch(/\bexport interface\b/);
    }
  });
});
