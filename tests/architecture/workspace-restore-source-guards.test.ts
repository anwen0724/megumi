// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const workspaceRoot = 'packages/coding-agent/workspace';

describe('workspace restore source guards', () => {
  it('keeps restore and snapshot capabilities out of the Workspace module', () => {
    const source = sourceUnder(workspaceRoot);
    const forbidden = [
      'WorkspaceRestoreService',
      'restoreChangeSet',
      'workspace_file_snapshots',
      'workspace_restore_operations',
      'workspace_restore_file_results',
      'saveFileSnapshot',
      'snapshotContent',
      'restoreState',
      'beforeHash',
      'afterHash',
    ];

    expect(forbidden.filter((term) => source.includes(term))).toEqual([]);
  });

  it('keeps Workspace change service focused on changed-file facts', () => {
    const source = read('packages/coding-agent/workspace/services/workspace-change-service.ts');

    expect(source).toContain('trackToolExecution');
    expect(source).toContain('insertOrUpdateChangedFile');
    expect(source).not.toContain('readFile');
    expect(source).not.toContain('writeFile');
    expect(source).not.toContain('WorkspaceRestoreService');
    expect(source).not.toContain('restoreChangeSet');
    expect(source).not.toContain('saveFileSnapshot');
    expect(source).not.toContain('restoreState');
  });

  it('does not make recovery IPC or runtime events a Workspace module requirement', () => {
    const source = sourceUnder(workspaceRoot);

    expect(source).not.toContain('WorkspaceRestorePayload');
    expect(source).not.toContain('workspace.restore.requested');
    expect(source).not.toContain('workspace.restore.completed');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sourceUnder(relativeDirectory: string): string {
  return sourceFiles(path.join(repoRoot, relativeDirectory))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...sourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      output.push(fullPath);
    }
  }
  return output;
}
