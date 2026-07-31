// Verifies every redesigned product table has exactly one repository/module owner.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  persistenceTableOwnership,
  targetDatabaseTables,
} from '@megumi/agent/persistence/schema';

const root = process.cwd();

describe('persistence table ownership', () => {
  it('assigns every target product table to exactly one owner', () => {
    const ownedTables = Object.values(persistenceTableOwnership).flatMap((owner) => owner.tables);

    expect([...ownedTables].sort()).toEqual([...targetDatabaseTables].sort());
    expect(new Set(ownedTables).size).toBe(ownedTables.length);
  });

  it('documents the aggregate repository that owns each table group', () => {
    expect(persistenceTableOwnership.session).toMatchObject({
      repository: 'SessionRepository',
      modulePath: 'packages/agent/session',
      tables: [
        'sessions',
        'session_entries',
        'session_messages',
        'session_message_attachments',
        'session_compactions',
      ],
    });

    expect(persistenceTableOwnership.skill).toMatchObject({
      module: 'skills',
      repository: 'SkillRepository',
      modulePath: 'packages/skills',
      tables: ['skill_availability'],
    });
  });

  it('keeps active persistence compatibility repos free of deleted Session and Workspace schema names', () => {
    const deletedNames = [
      'session_leaf_changes',
      'blocks_json',
      'entry_kind',
      'target_entry_id',
      'workspace_file_snapshots',
      'workspace_restore_operations',
      'workspace_restore_file_results',
      'restore_state',
      'before_exists',
      'before_snapshot_id',
      'before_hash',
      'after_exists',
      'after_snapshot_id',
      'after_hash',
    ];
    const files = [
      'packages/agent/session/repository/session-repository.ts',
      'packages/agent/workspace/repositories/workspace-repository.ts',
      'packages/agent/workspace/repositories/workspace-change-repository.ts',
      'packages/agent/persistence/schema/table-list.ts',
      'packages/agent/persistence/schema/table-ownership.ts',
    ];
    const violations = files.flatMap((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      return deletedNames
        .filter((name) => source.includes(name))
        .map((name) => `${file} contains ${name}`);
    });

    expect(violations).toEqual([]);
  });
});
