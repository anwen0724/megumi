// @vitest-environment node
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';

let db: Database.Database | null = null;

function createTestDb(): Database.Database {
  db = new Database(':memory:');
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('provider settings migrations', () => {
  it('creates provider settings table with the expected columns', () => {
    const database = createTestDb();

    migrateDatabase(database);

    const columns = database
      .prepare("PRAGMA table_info(provider_settings)")
      .all() as Array<{ name: string; notnull: 0 | 1; pk: 0 | 1 }>;

    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'provider_id',
      'kind',
      'display_name',
      'enabled',
      'base_url',
      'default_model_id',
      'secret_ref_id',
      'secret_ref_provider_id',
      'secret_ref_scope',
      'created_at',
      'updated_at',
    ]);

    expect(columns.find((column) => column.name === 'provider_id')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'provider_id')?.pk).toBe(0);
  });

  it('is idempotent', () => {
    const database = createTestDb();

    migrateDatabase(database);
    migrateDatabase(database);

    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_settings'")
      .get() as { name: string } | undefined;

    expect(table).toEqual({ name: 'provider_settings' });
  });

  it('creates session run tables and indexes', () => {
    const database = createTestDb();

    migrateDatabase(database);

    const rows = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'run_actions',
      'run_observations',
      'runs',
      'sessions',
      'run_steps',
      'approval_records',
      'approval_requests',
      'session_messages',
      'runtime_events',
      'tool_calls',
      'tool_observations',
      'tool_policy_decisions',
    ]));

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_run_actions_step_id',
      'idx_run_observations_run_id',
      'idx_runs_session_id',
      'idx_run_steps_run_id',
      'idx_approval_requests_tool_call_id',
      'idx_session_messages_session_id',
      'idx_runtime_events_run_sequence',
      'idx_tool_calls_run_id',
      'idx_tool_calls_status',
      'idx_tool_observations_tool_call_id',
    ]));
  });

  it('creates run mode and implementation plan tables', () => {
    const database = createTestDb();
    migrateDatabase(database);

    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      AND name IN (
        'run_mode_snapshots',
        'implementation_plan_artifacts',
        'run_source_plans'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      'implementation_plan_artifacts',
      'run_mode_snapshots',
      'run_source_plans',
    ]);
  });

  it('indexes run mode and source plan lookup paths', () => {
    const database = createTestDb();
    migrateDatabase(database);

    const indexes = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index'
      AND name IN (
        'idx_run_mode_snapshots_run_id',
        'idx_implementation_plan_artifacts_producing_run_id',
        'idx_run_source_plans_source_plan_id'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_implementation_plan_artifacts_producing_run_id',
      'idx_run_mode_snapshots_run_id',
      'idx_run_source_plans_source_plan_id',
    ]);
  });

  it('creates recovery persistence tables', () => {
    const database = createTestDb();
    migrateDatabase(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'checkpoints',
        'resume_requests',
        'cancel_requests',
        'retry_requests',
        'checkpoint_restore_records',
        'artifacts',
        'artifact_versions',
        'artifact_source_refs',
        'artifact_relations',
      ]),
    );

    const checkpointColumns = database
      .prepare('PRAGMA table_info(checkpoints)')
      .all() as Array<{ name: string }>;

    expect(checkpointColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'checkpoint_id',
      'run_id',
      'step_id',
      'action_id',
      'reason',
      'status',
      'boundary',
      'sequence',
      'schema_version',
      'created_at',
      'created_by',
      'mode_snapshot_ref',
      'context_build_ref',
      'policy_snapshot_ref',
      'tool_registry_snapshot_ref',
      'approval_request_id',
      'tool_call_id',
      'parent_checkpoint_id',
      'side_effect_refs_json',
      'resume_cursor',
      'state_summary',
      'state_ref',
      'metadata_json',
      'checkpoint_json',
    ]));

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_artifacts_session_id',
      'idx_artifacts_producing_run_id',
      'idx_artifact_versions_artifact_id',
      'idx_artifact_source_refs_artifact_id',
      'idx_artifact_relations_from_artifact_id',
      'idx_artifact_relations_to_artifact_id',
    ]));
  });

  it('does not create active agent-prefixed session run tables or indexes', () => {
    const source = readFileSync('packages/db/schema/migrations.ts', 'utf8');

    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS agent_(sessions|runs|steps|actions|observations|context_baselines|run_mode_snapshots|run_source_plans|checkpoints|resume_requests|cancel_requests|retry_requests)/);
    expect(source).not.toMatch(/CREATE INDEX IF NOT EXISTS idx_agent_(runs|steps|actions|observations|context|run_mode|run_source|checkpoints|resume|cancel|retry)/);
  });
});
