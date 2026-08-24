/* Guards that production TypeScript and TSX only use executionId identity. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const CODE_ROOTS = ['packages', 'apps', 'evals'];
const CODE_EXTENSIONS = ['.ts', '.tsx'];

/** Files explicitly allowed to reference the legacy run_id/runId names. */
const ALLOWED_FILES = new Set([
  // Explicit legacy-format compatibility reads of V1 tables that predate the redesign.
  'packages/agent/database/src/legacy-session-history-migration.ts',
]);

function collectCodeFiles(): string[] {
  const files: string[] = [];
  for (const codeRoot of CODE_ROOTS) {
    const absolute = path.join(root, codeRoot);
    if (!fs.existsSync(absolute)) continue;
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(entryPath);
          continue;
        }
        if (CODE_EXTENSIONS.includes(path.extname(entry.name))) files.push(entryPath);
      }
    };
    walk(absolute);
  }
  return files;
}

describe('execution identity source guards', () => {
  it('defines no runId, run_id or createRunId in production TypeScript and TSX', () => {
    const violations: string[] = [];
    for (const file of collectCodeFiles()) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(relative)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const term of ['runId', 'run_id', 'createRunId']) {
        if (source.includes(term)) violations.push(`${relative}: ${term}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the active Drizzle schema on execution_id columns and indexes', () => {
    const schema = fs.readFileSync(path.join(root, 'packages/agent/database/src/database-schema.ts'), 'utf8');
    expect(schema).toContain("text('execution_id')");
    expect(schema).toContain('idx_session_messages_execution');
    expect(schema).toContain('idx_workspace_changes_execution');
    expect(schema).not.toMatch(/\brun_id\b/u);
    expect(schema).not.toMatch(/\brunId\b/u);
  });

  it('keeps the released rename migration append-only and data-preserving', () => {
    const migration = fs.readFileSync(
      path.join(root, 'packages/agent/database/migrations/0011_execution_id.sql'),
      'utf8',
    );
    expect(migration).toContain('RENAME COLUMN `run_id` TO `execution_id`');
    expect(migration).toContain('idx_session_messages_execution');
    expect(migration).toContain('idx_workspace_changes_execution');
    expect(migration).not.toMatch(/CREATE TABLE/u);
  });
});
