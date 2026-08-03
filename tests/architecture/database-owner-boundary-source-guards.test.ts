/* Guards Database infrastructure ownership and prevents runtime/business storage from returning. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const forbiddenRuntimeTables = [
  'runs',
  'runtime_events',
  'model_calls',
  'model_steps',
  'tool_executions',
  'tool_results',
  'permission_decisions',
  'permission_snapshots',
  'approval_records',
  'checkpoints',
  'memory_candidates',
  'memory_recall_requests',
  'memory_recall_results',
  'artifact_relations',
] as const;

describe('Database Owner boundaries', () => {
  it('keeps business Store implementations out of Database', () => {
    const source = readTree('packages/database/src');

    expect(source).not.toMatch(/@megumi\/(?:commands|context|engine|events|input|instructions|permissions|product|projections|session|settings|skills|tools|workspace)(?:\/|['"])/u);
    expect(source).not.toMatch(/class\s+(?:Workspace|Session|Skill|Tool|Run|Artifact|Memory)Repository/u);
    expect(source).not.toMatch(/create(?:Workspace|Session|Skill|Tool|Run|Artifact|Memory)Store/u);
  });

  it('keeps transient execution, Artifact, and Memory tables out of the current schema', () => {
    const source = [
      read('packages/database/src/database-schema.ts'),
      read('packages/database/src/database-tables.ts'),
    ].join('\n');
    const violations = forbiddenRuntimeTables.filter((table) => containsIdentifier(source, table));

    expect(violations).toEqual([]);
  });

  it('keeps each business Store in its owning Package', () => {
    expect(read('packages/workspace/src/workspace-store.ts')).toContain('createWorkspaceStore');
    expect(read('packages/session/src/session-store.ts')).toContain('createSessionStore');
    expect(readTree('packages/skills/src')).toContain('createDatabaseSkillAvailabilityStore');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(?:ts|tsx|mts|cts)$/u.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}

function containsIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'u').test(source);
}
