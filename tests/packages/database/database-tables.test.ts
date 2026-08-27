// Verifies every redesigned product table has exactly one repository/module owner.
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  databaseTableOwnership,
  databaseTables,
} from '../../../packages/agent/database/src';

const root = process.cwd();

describe('Database table ownership', () => {
  it('assigns every target product table to exactly one owner', () => {
    const ownedTables = Object.values(databaseTableOwnership).flatMap((owner) => owner.tables);

    expect([...ownedTables].sort()).toEqual([...databaseTables].sort());
    expect(new Set(ownedTables).size).toBe(ownedTables.length);
  });

  it('documents the aggregate repository that owns each table group', () => {
    expect(databaseTableOwnership.session).toMatchObject({
      repository: 'SessionStore',
      modulePath: 'packages/agent/session',
      tables: [
        'sessions',
        'session_entries',
        'session_messages',
        'session_message_attachments',
        'session_compactions',
      ],
    });

    expect(databaseTableOwnership.skill).toMatchObject({
      module: 'skills',
      repository: 'SkillRepository',
      modulePath: 'packages/agent/skills',
      tables: ['skill_availability'],
    });

    expect(databaseTableOwnership.discovery).toMatchObject({
      module: 'discovery-agent',
      repository: 'DiscoveryRepository',
      modulePath: 'packages/agent/discovery',
      tables: [
        'discovery_interests',
        'discovery_interest_evidence',
        'discovery_session_policies',
        'discovery_batches',
        'discovery_recommendations',
        'discovery_candidate_queries',
        'discovery_candidates',
        'discovery_candidate_sources',
        'discovery_candidate_query_results',
        'discovery_candidate_assessments',
        'discovery_candidate_interests',
        'discovery_candidate_supply_state',
        'discovery_candidate_source_state',
        'discovery_feedback_changes',
        'discovery_preference_learning_batches',
        'discovery_preference_scopes',
        'discovery_preference_directions',
        'discovery_preference_direction_feedback',
      ],
    });
  });

  it('keeps active business repositories free of deleted Session and Workspace schema names', () => {
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
      'packages/agent/session/src/session-store.ts',
      'packages/agent/workspace/src/workspace-store.ts',
      'packages/agent/database/src/database-tables.ts',
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
