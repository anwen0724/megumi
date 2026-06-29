// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const productionRoots = [
  'apps/desktop/src',
  'packages/ai',
  'packages/coding-agent/context',
  'packages/coding-agent/persistence',
  'packages/shared',
];

const restoreBoundaryTerms = [
  'WorkspaceChangeRepository',
  'WorkspaceRestoreService',
  'workspace_restore_requests',
  'workspace_changed_files',
  'current_hash_mismatch',
  'restoreModifiedFile',
  'restoreCreatedFile',
  'restoreDeletedFile',
];

const restoreBoundaryAllowlist = new Set([
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/main/shell-composition/desktop-main-composition.ts',
  'packages/coding-agent/composition/compose-database.ts',
  'packages/coding-agent/persistence/compose-desktop-persistence.ts',
  'packages/coding-agent/persistence/repos/workspace-change.repo.ts',
  'packages/coding-agent/persistence/schema/migrations.ts',
  'packages/coding-agent/composition/compose-recovery-runtime.ts',
  'packages/coding-agent/composition/compose-session-runtime.ts',
  'packages/coding-agent/composition/compose-tool-runtime.ts',
  'apps/desktop/src/main/ipc/handlers/recovery.handler.ts',
  'apps/desktop/src/main/ipc/register-ipc-handlers.ts',
  'packages/coding-agent/state/recovery-service.ts',
  'packages/coding-agent/input/input-service.ts',
  'packages/coding-agent/workspace/workspace-change-tracker.ts',
  'packages/coding-agent/workspace/workspace-restore.ts',
  'packages/shared/ipc/schemas.ts',
  'packages/shared/recovery/contracts.ts',
  'packages/shared/runtime/event-factory.ts',
  'packages/shared/runtime/event-schemas.ts',
  'packages/shared/runtime/events.ts',
  'packages/shared/workspace/change-contracts.ts',
]);

const forbiddenRestoreRoots = [
  'apps/desktop/src/renderer',
  'packages/ai',
  'packages/coding-agent/context',
];

const rawContentTerms = [
  'contentText',
  'before secret',
  'after secret',
  'beforeContent',
  'afterContent',
  'beforeContentRefId',
  'afterContentRefId',
  'beforeHash',
  'afterHash',
];

const runtimeAndIpcSchemaFiles = [
  'packages/shared/runtime/events.ts',
  'packages/shared/runtime/event-schemas.ts',
  'packages/shared/runtime/event-factory.ts',
  'packages/shared/ipc/schemas.ts',
];

const runCommandExecutorPath = 'packages/coding-agent/tools/execution/tool-executors/run-command.executor.ts';
const runCommandPathFiles = [
  runCommandExecutorPath,
  'packages/coding-agent/tools/execution/built-in-tool-source-executor.ts',
  'packages/coding-agent/tools/execution/tool-execution-router.ts',
  'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts',
];

describe('workspace restore source guards', () => {
  it('keeps workspace restore repository and safety logic in explicit backend boundaries', () => {
    const matches = productionRoots
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .flatMap((file) => forbiddenMatchesOutsideAllowlist(file, restoreBoundaryTerms, restoreBoundaryAllowlist));

    expect(matches).toEqual([]);
  });

  it('keeps renderer provider and coding-agent context away from restore persistence and safety logic', () => {
    const matches = forbiddenRestoreRoots
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .flatMap((file) => forbiddenMatches(file, restoreBoundaryTerms));

    expect(matches).toEqual([]);
  });

  it('keeps renderer provider and coding-agent context from owning workspace change storage or restore safety decisions', () => {
    const forbiddenTerms = [
      'WorkspaceChangeRepository',
      'WorkspaceRestoreService',
      'workspace_change_sets',
      'workspace_changed_files',
      'workspace_snapshot_contents',
      'workspace_restore_requests',
      'current_hash_mismatch',
      'restoreModifiedFile',
      'restoreCreatedFile',
      'restoreDeletedFile',
      'beforeContentRefId',
      'afterContentRefId',
      'beforeHash',
      'afterHash',
    ];
    const matches = forbiddenRestoreRoots
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .flatMap((file) => forbiddenMatches(file, forbiddenTerms));

    expect(matches).toEqual([]);
  });

  it('keeps WorkspaceRestoreService free of git and stash commands', () => {
    const source = read('packages/coding-agent/workspace/workspace-restore.ts');

    expect(source).not.toContain('child_process');
    expect(source).not.toContain('simple-git');
    expect(source).not.toContain('git.cmd');
    expect(source).not.toContain('git.exe');
    expect(source).not.toMatch(/(^|[^A-Za-z])git([^A-Za-z]|$)/i);
    expect(source).not.toMatch(/(^|[^A-Za-z])stash([^A-Za-z]|$)/i);
  });

  it('keeps runtime event and IPC schemas from exposing raw snapshot content', () => {
    const matches = runtimeAndIpcSchemaFiles.flatMap((file) => forbiddenMatches(
      path.join(repoRoot, file),
      rawContentTerms,
    ));

    expect(matches).toEqual([]);
  });

  it('keeps run_command executor path from creating workspace change restore records', () => {
    const forbiddenRecordCalls = [
      'saveRestoreRequest',
      'saveRestoreResult',
      'saveRestoreFileResult',
      'updateRestoreRequestStatus',
      'updateChangedFileRestoreState',
      'workspace_restore_requests',
      'workspace_restore_results',
      'workspace_restore_file_results',
    ];
    const matches = runCommandPathFiles
      .flatMap((file) => forbiddenMatches(path.join(repoRoot, file), forbiddenRecordCalls));

    expect(matches).toEqual([]);
    expect(read(runCommandExecutorPath)).not.toContain('WorkspaceChangeRepository');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

function forbiddenMatchesOutsideAllowlist(file: string, terms: string[], allowlist: Set<string>): string[] {
  const relative = relativePath(file);
  if (allowlist.has(relative)) return [];
  return forbiddenMatches(file, terms);
}

function forbiddenMatches(file: string, terms: string[]): string[] {
  const relative = relativePath(file);
  const source = fs.readFileSync(file, 'utf8');
  return terms
    .filter((term) => source.includes(term))
    .map((term) => `${relative} contains ${term}`);
}

function relativePath(file: string): string {
  return path.relative(repoRoot, file).replace(/\\/g, '/');
}
