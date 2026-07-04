// Verifies every redesigned product table has exactly one repository/module owner.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  persistenceTableOwnership,
  targetDatabaseTables,
} from '@megumi/coding-agent/persistence/schema';

const root = process.cwd();
const targetTableSet = new Set<string>(targetDatabaseTables);

const repositoryOwnership = {
  'workspace.repo.ts': persistenceTableOwnership.workspace.tables,
  'agent-loop.repo.ts': persistenceTableOwnership.agentLoop.tables,
  'tool-call.repo.ts': persistenceTableOwnership.toolCall.tables,
  'workspace-change.repo.ts': persistenceTableOwnership.workspaceChange.tables,
  'memory.repo.ts': persistenceTableOwnership.memory.tables,
  'artifact.repo.ts': persistenceTableOwnership.artifact.tables,
} as const;

const legacySessionCompatibilityTables = new Set<string>([
  ...persistenceTableOwnership.session.tables,
  ...persistenceTableOwnership.legacySessionCompatibility.tables,
]);

describe('persistence table ownership', () => {
  it('assigns every target product table to exactly one owner', () => {
    const ownedTables = Object.values(persistenceTableOwnership).flatMap((owner) => owner.tables);

    expect([...ownedTables].sort()).toEqual([...targetDatabaseTables].sort());
    expect(new Set(ownedTables).size).toBe(ownedTables.length);
  });

  it('documents the aggregate repository that owns each table group', () => {
    expect(persistenceTableOwnership.session).toMatchObject({
      repository: 'SessionRepository',
      modulePath: 'packages/coding-agent/session',
      tables: [
        'sessions',
        'session_entries',
        'session_messages',
        'session_message_attachments',
        'session_compactions',
      ],
    });

    expect(persistenceTableOwnership.legacySessionCompatibility).toMatchObject({
      repository: 'LegacySessionRepository',
      modulePath: 'packages/coding-agent/persistence/repos/session.repo.ts',
      tables: [
        'session_leaf_changes',
      ],
    });

    expect(persistenceTableOwnership.agentLoop).toMatchObject({
      repository: 'AgentLoopRepository',
      tables: [
        'agent_loop_runs',
        'model_calls',
        'agent_loop_events',
        'tool_registry_snapshots',
      ],
    });
  });

  it('keeps repository SQL writes inside each aggregate owner', () => {
    const violations: string[] = [];
    const repoDirectory = path.join(root, 'packages/coding-agent/persistence/repos');

    for (const [repoFile, allowedTables] of Object.entries(repositoryOwnership)) {
      const source = fs.readFileSync(path.join(repoDirectory, repoFile), 'utf8');
      const allowed = new Set<string>(allowedTables);

      for (const write of findSqlWrites(source)) {
        if (!allowed.has(write.table)) {
          violations.push(`${repoFile} ${write.operation} ${write.table}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps legacy persistence session repository as compatibility only', () => {
    const source = fs.readFileSync(
      path.join(root, 'packages/coding-agent/persistence/repos/session.repo.ts'),
      'utf8',
    );
    const violations = findSqlWrites(source)
      .filter((write) => !legacySessionCompatibilityTables.has(write.table))
      .map((write) => `session.repo.ts ${write.operation} ${write.table}`);

    expect(violations).toEqual([]);
  });
});

function findSqlWrites(source: string): Array<{ operation: string; table: string }> {
  const writes: Array<{ operation: string; table: string }> = [];
  const pattern = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;

  for (const match of source.matchAll(pattern)) {
    if (!targetTableSet.has(match[2])) {
      continue;
    }

    writes.push({
      operation: match[1].replace(/\s+/g, ' ').toUpperCase(),
      table: match[2],
    });
  }

  return writes;
}
