// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('workspace change managed write source guards', () => {
  it('keeps workspace change persistence out of renderer, provider, and context-management', () => {
    const forbidden = [
      'WorkspaceChangeRepository',
      'WorkspaceChangeTrackerService',
      'workspace_change_sets',
      'workspace_checkpoints',
      'workspace_changed_files',
      'workspace_snapshot_contents',
    ];
    const roots = [
      'apps/desktop/src/renderer',
      'packages/context-management',
      'packages/ai',
    ];

    const matches = roots.flatMap((root) => scanFiles(path.join(repoRoot, root), forbidden));
    expect(matches).toEqual([]);
  });

  it('does not make run_command restorable in production code', () => {
    const trackerSource = fs.readFileSync(
      path.join(repoRoot, 'apps/desktop/src/main/services/workspace-change-tracker.service.ts'),
      'utf8',
    );
    expect(trackerSource).toContain("MANAGED_FILE_TOOL_NAMES = new Set(['edit_file', 'write_file'])");
    expect(trackerSource).not.toMatch(/MANAGED_FILE_TOOL_NAMES[\s\S]*run_command/);

    const roots = [
      'apps/desktop/src/main',
      'packages/shared',
      'packages/db',
    ];
    const files = roots.flatMap((root) => productionFiles(path.join(repoRoot, root)));
    const matches = files.flatMap((file) => scanRunCommandWorkspaceWindows(file));

    expect(matches).toEqual([]);
  });
});

function scanFiles(root: string, forbidden: string[]): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...scanFiles(fullPath, forbidden));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const term of forbidden) {
      if (content.includes(term)) {
        output.push(`${path.relative(repoRoot, fullPath).replace(/\\/g, '/')} contains ${term}`);
      }
    }
  }
  return output;
}

function productionFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...productionFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    output.push(fullPath);
  }
  return output;
}

function scanRunCommandWorkspaceWindows(file: string): string[] {
  const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('run_command')) continue;
    const window = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join('\n');
    if (/\b(workspace|restorable|restoreState|changeSet|checkpoint|changedFile)\b/i.test(window)) {
      output.push(`${relative}:${index + 1}`);
    }
  }
  return output;
}
