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

function topLevelDirectories(relativeDirectory: string): string[] {
  const absolute = join(root, relativeDirectory);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('desktop shell and coding-agent host interface recovery', () => {
  it('places host interface, composition, persistence, and local adapters under packages/coding-agent', () => {
    expect(existsSync(join(root, 'packages/coding-agent/host-interface/host-interface.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/composition/compose-coding-agent-persistence.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/schema/migrate.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/repos/session-run.repo.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/repos/agent-loop.repo.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/repos/session.repo.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/repos/tool-call.repo.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/services/tool-execution-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/adapters/built-in-tools.ts'))).toBe(true);
  });

  it('removes desktop-owned product persistence and local coding tool execution', () => {
    expect(existsSync(join(root, 'apps/desktop/src/main/persistence'))).toBe(false);
    expect(existsSync(join(root, 'apps/desktop/src/main/services/tool/tool-executors'))).toBe(false);
    expect(existsSync(join(root, 'apps/desktop/src/main/services/session/session-run.service.ts'))).toBe(false);
    expect(existsSync(join(root, 'apps/desktop/src/main/composition'))).toBe(false);
  });

  it('keeps desktop main services as UI shell facades only', () => {
    // Desktop services only host real Electron/shell adapter logic. Pure pass-through
    // facades were removed (handlers code against host interface ports directly), so
    // the directory set is asserted as a SUBSET of allowed shell-adapter homes rather
    // than an exact list — a dir legitimately disappears when it has no shell logic
    // left (e.g. provider/ after its facade was deleted).
    const allowedServiceDirectories = new Set([
      'agent-run',
      'provider',
      'security',
      'session',
      'settings',
      'workspace',
    ]);
    const actual = topLevelDirectories('apps/desktop/src/main/services');
    expect(actual.filter((name) => !allowedServiceDirectories.has(name))).toEqual([]);

    const desktopServices = sourceUnder('apps/desktop/src/main/services');
    expect(desktopServices).not.toContain('class AgentRunProcessingService');
    expect(desktopServices).not.toContain('createToolOrchestratorService');
    expect(desktopServices).not.toContain('new SessionRunRepository');
    expect(desktopServices).not.toContain('applyCodingAgentDatabaseMigrations');
    expect(desktopServices).not.toContain('createDatabase(');
    expect(desktopServices).not.toContain('createBuiltInToolSourceExecutor');
    expect(desktopServices).not.toContain('createToolExecutionRouter');
  });

  it('keeps coding-agent independent from desktop and Electron UI shell', () => {
    const source = sourceUnder('packages/coding-agent');
    const forbidden = [
      '@megumi/desktop',
      'apps/desktop',
      "from 'electron'",
      'BrowserWindow',
      'ipcMain',
      'preload',
      'renderer',
    ];

    expect(forbidden.filter((pattern) => source.includes(pattern))).toEqual([]);
  });

  it('keeps desktop from importing model access directly', () => {
    const source = sourceUnder('apps/desktop/src/main');
    expect(source).not.toContain("from '@megumi/ai");
    expect(source).not.toContain('from "@megumi/ai');
  });

  it('keeps package-level tests proving Coding Agent can run without desktop imports', () => {
    expect(existsSync(join(root, 'tests/packages/coding-agent/host-interface/host-interface.test.ts'))).toBe(true);
    expect(existsSync(join(root, 'tests/packages/coding-agent/input/input-service-v2.test.ts'))).toBe(true);
    expect(existsSync(join(root, 'tests/packages/coding-agent/agent-loop/agent-run-service.test.ts'))).toBe(true);
    expect(existsSync(join(root, 'tests/packages/coding-agent/persistence/repos/session-run.repo.test.ts'))).toBe(false);
    expect(existsSync(join(root, 'tests/packages/coding-agent/persistence/repos/agent-loop.repo.test.ts'))).toBe(true);
    expect(existsSync(join(root, 'tests/packages/coding-agent/persistence/repos/session.repo.test.ts'))).toBe(false);
  });
});
