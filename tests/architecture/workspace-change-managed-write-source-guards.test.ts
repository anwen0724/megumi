// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('workspace change managed write source guards', () => {
  it('keeps workspace change persistence out of renderer, provider, and context code', () => {
    const forbidden = [
      'WorkspaceChangeRepository',
      'WorkspaceChangeService',
      'workspace_changes',
      'workspace_changed_files',
      'workspace_restore',
      'workspace_snapshot',
    ];
    const roots = [
      'apps/desktop/src/renderer',
      'packages/coding-agent/context',
      'packages/ai',
    ];

    const matches = roots.flatMap((root) => scanFiles(path.join(repoRoot, root), forbidden));
    expect(matches).toEqual([]);
  });

  it('records only successful managed file mutations', () => {
    const source = read('packages/coding-agent/workspace/services/workspace-change-service.ts');
    const coreSource = read('packages/coding-agent/workspace/core/workspace-change-tracking.ts');

    expect(coreSource).toContain("tool_execution.tool_name !== 'write_file'");
    expect(coreSource).toContain("tool_execution.tool_name !== 'edit_file'");
    expect(source).toMatch(/const result = await request\.execute\(\);[\s\S]*insertOrUpdateChangedFile/);
    expect(coreSource).not.toContain("'run_command'");
  });

  it('keeps run_command executor paths away from workspace restore record writes', () => {
    const files = [
      'packages/coding-agent/tools/adapters/built-in-tools.ts',
      'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts',
    ];
    const forbidden = [
      'workspace_restore_operations',
      'workspace_restore_file_results',
      'restoreWorkspaceChangeSet',
      'WorkspaceRestoreService',
      'restoreState',
    ];

    const matches = files.flatMap((file) => scanFiles(path.join(repoRoot, file), forbidden));
    expect(matches).toEqual([]);
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function scanFiles(root: string, forbidden: string[]): string[] {
  if (!fs.existsSync(root)) return [];
  if (fs.statSync(root).isFile()) {
    return scanFile(root, forbidden);
  }
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...scanFiles(fullPath, forbidden));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    output.push(...scanFile(fullPath, forbidden));
  }
  return output;
}

function scanFile(file: string, forbidden: string[]): string[] {
  const content = fs.readFileSync(file, 'utf8');
  return forbidden
    .filter((term) => content.includes(term))
    .map((term) => `${path.relative(repoRoot, file).replace(/\\/g, '/')} contains ${term}`);
}
