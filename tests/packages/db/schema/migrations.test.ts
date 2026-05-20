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

function tableColumns(
  database: Database.Database,
  tableName: string,
): Array<{ name: string; notnull: 0 | 1; pk: 0 | 1 }> {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string; notnull: 0 | 1; pk: 0 | 1 }>;
}

function columnByName(
  columns: Array<{ name: string; notnull: 0 | 1; pk: 0 | 1 }>,
  name: string,
): { name: string; notnull: 0 | 1; pk: 0 | 1 } | undefined {
  return columns.find((column) => column.name === name);
}

function foreignKeys(
  database: Database.Database,
  tableName: string,
): Array<{ from: string; table: string; on_delete: string }> {
  return database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as Array<{ from: string; table: string; on_delete: string }>;
}

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function seedLegacyToolPersistenceSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE tool_calls (
      tool_call_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_preview_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      side_effect TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      tool_call_json TEXT NOT NULL
    );

    CREATE TABLE tool_policy_decisions (
      policy_decision_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      decision_json TEXT NOT NULL
    );

    CREATE TABLE approval_requests (
      approval_request_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_scope TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      resolved_at TEXT,
      request_json TEXT NOT NULL
    );

    CREATE TABLE approval_records (
      approval_record_id TEXT PRIMARY KEY,
      approval_request_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      scope TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );

    CREATE TABLE tool_observations (
      observation_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      text_preview TEXT,
      content_refs_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      observation_json TEXT NOT NULL
    );

    CREATE INDEX idx_tool_calls_run_id
    ON tool_calls(run_id);

    CREATE INDEX idx_tool_calls_status
    ON tool_calls(status);

    CREATE INDEX idx_approval_requests_tool_call_id
    ON approval_requests(tool_call_id);

    CREATE INDEX idx_tool_observations_tool_call_id
    ON tool_observations(tool_call_id);

    INSERT INTO tool_calls (
      tool_call_id,
      run_id,
      step_id,
      action_id,
      tool_name,
      input_preview_json,
      capabilities_json,
      risk_level,
      side_effect,
      status,
      requested_at,
      tool_call_json
    )
    VALUES (
      'tool-call:legacy',
      'run:legacy',
      'step:legacy',
      'action:legacy',
      'read_file',
      '{}',
      '[]',
      'low',
      'none',
      'completed',
      '2026-05-20T00:00:00.000Z',
      '{}'
    );

    INSERT INTO tool_policy_decisions (
      policy_decision_id,
      tool_call_id,
      run_id,
      decision,
      reason,
      decided_at,
      decision_json
    )
    VALUES (
      'policy:legacy',
      'tool-call:legacy',
      'run:legacy',
      'allow',
      'legacy decision',
      '2026-05-20T00:00:01.000Z',
      '{}'
    );

    INSERT INTO approval_requests (
      approval_request_id,
      tool_call_id,
      run_id,
      step_id,
      tool_name,
      status,
      requested_scope,
      risk_level,
      created_at,
      request_json
    )
    VALUES (
      'approval-request:legacy',
      'tool-call:legacy',
      'run:legacy',
      'step:legacy',
      'read_file',
      'approved',
      'once',
      'low',
      '2026-05-20T00:00:02.000Z',
      '{}'
    );

    INSERT INTO approval_records (
      approval_record_id,
      approval_request_id,
      tool_call_id,
      run_id,
      step_id,
      decision,
      scope,
      decided_by,
      decided_at,
      record_json
    )
    VALUES (
      'approval-record:legacy',
      'approval-request:legacy',
      'tool-call:legacy',
      'run:legacy',
      'step:legacy',
      'approved',
      'once',
      'user',
      '2026-05-20T00:00:03.000Z',
      '{}'
    );

    INSERT INTO tool_observations (
      observation_id,
      tool_call_id,
      run_id,
      step_id,
      status,
      summary,
      created_at,
      observation_json
    )
    VALUES (
      'tool-observation:legacy',
      'tool-call:legacy',
      'run:legacy',
      'step:legacy',
      'completed',
      'legacy observation',
      '2026-05-20T00:00:04.000Z',
      '{}'
    );
  `);
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
      'model_steps',
      'session_messages',
      'runtime_events',
      'tool_calls',
      'tool_observations',
      'tool_results',
      'tool_uses',
      'permission_decisions',
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
      'idx_model_steps_run_id',
      'idx_session_messages_session_id',
      'idx_runtime_events_run_sequence',
      'idx_tool_calls_run_id',
      'idx_tool_calls_status',
      'idx_tool_calls_tool_use_id',
      'idx_tool_observations_tool_call_id',
      'idx_tool_results_tool_use_id',
      'idx_tool_uses_model_step_id',
      'idx_tool_uses_run_id',
      'idx_permission_decisions_tool_use_id',
    ]));
  });

  it('creates Plan 1 tool use schema columns', () => {
    const database = createTestDb();

    migrateDatabase(database);

    const modelStepColumns = tableColumns(database, 'model_steps');
    expect(modelStepColumns.map((column) => column.name)).toEqual([
      'model_step_id',
      'run_id',
      'step_id',
      'provider_id',
      'model_id',
      'status',
      'started_at',
      'completed_at',
      'error_json',
      'metadata_json',
      'model_step_json',
    ]);
    for (const requiredColumn of [
      'run_id',
      'provider_id',
      'model_id',
      'status',
      'started_at',
      'model_step_json',
    ]) {
      expect(columnByName(modelStepColumns, requiredColumn)?.notnull).toBe(1);
    }

    const toolUseColumns = tableColumns(database, 'tool_uses');
    expect(toolUseColumns.map((column) => column.name)).toEqual([
      'tool_use_id',
      'run_id',
      'model_step_id',
      'provider_tool_use_id',
      'tool_name',
      'input_json',
      'input_preview_json',
      'status',
      'created_at',
      'completed_at',
      'error_json',
      'metadata_json',
      'tool_use_json',
    ]);
    for (const requiredColumn of [
      'run_id',
      'model_step_id',
      'provider_tool_use_id',
      'tool_name',
      'input_json',
      'input_preview_json',
      'status',
      'created_at',
      'tool_use_json',
    ]) {
      expect(columnByName(toolUseColumns, requiredColumn)?.notnull).toBe(1);
    }

    const toolCallColumns = tableColumns(database, 'tool_calls');
    expect(toolCallColumns.map((column) => column.name)).toEqual([
      'tool_call_id',
      'tool_use_id',
      'run_id',
      'step_id',
      'action_id',
      'tool_name',
      'input_preview_json',
      'capabilities_json',
      'risk_level',
      'side_effect',
      'result_preview',
      'status',
      'requested_at',
      'started_at',
      'completed_at',
      'error_json',
      'metadata_json',
      'tool_call_json',
    ]);
    for (const requiredColumn of [
      'tool_use_id',
      'run_id',
      'step_id',
      'tool_name',
      'input_preview_json',
      'capabilities_json',
      'risk_level',
      'side_effect',
      'status',
      'requested_at',
      'tool_call_json',
    ]) {
      expect(columnByName(toolCallColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(toolCallColumns, 'action_id')?.notnull).toBe(0);

    const toolResultColumns = tableColumns(database, 'tool_results');
    expect(toolResultColumns.map((column) => column.name)).toEqual([
      'tool_result_id',
      'tool_use_id',
      'tool_call_id',
      'run_id',
      'kind',
      'text_content',
      'structured_content_json',
      'content_refs_json',
      'redaction_state',
      'error_json',
      'denial_reason',
      'created_at',
      'metadata_json',
      'result_json',
    ]);
    for (const requiredColumn of [
      'tool_use_id',
      'run_id',
      'kind',
      'redaction_state',
      'created_at',
      'result_json',
    ]) {
      expect(columnByName(toolResultColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(toolResultColumns, 'tool_call_id')?.notnull).toBe(0);

    const permissionDecisionColumns = tableColumns(database, 'permission_decisions');
    expect(permissionDecisionColumns.map((column) => column.name)).toEqual([
      'permission_decision_id',
      'tool_use_id',
      'tool_call_id',
      'run_id',
      'decision',
      'source',
      'mode',
      'reason',
      'classifier_label',
      'capability',
      'side_effect',
      'matched_rule_json',
      'target',
      'effective_risk_level',
      'required_approval_json',
      'required_sandbox_json',
      'evaluated_at',
      'metadata_json',
      'decision_json',
    ]);
    for (const requiredColumn of [
      'tool_use_id',
      'run_id',
      'decision',
      'source',
      'mode',
      'reason',
      'capability',
      'side_effect',
      'effective_risk_level',
      'evaluated_at',
      'decision_json',
    ]) {
      expect(columnByName(permissionDecisionColumns, requiredColumn)?.notnull).toBe(1);
    }

    const approvalRequestColumns = tableColumns(database, 'approval_requests');
    expect(approvalRequestColumns.map((column) => column.name)).toEqual([
      'approval_request_id',
      'tool_use_id',
      'tool_call_id',
      'permission_decision_id',
      'run_id',
      'step_id',
      'tool_name',
      'status',
      'requested_scope',
      'risk_level',
      'created_at',
      'expires_at',
      'resolved_at',
      'request_json',
    ]);
    for (const requiredColumn of [
      'tool_use_id',
      'tool_call_id',
      'run_id',
      'step_id',
      'tool_name',
      'status',
      'requested_scope',
      'risk_level',
      'created_at',
      'request_json',
    ]) {
      expect(columnByName(approvalRequestColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(approvalRequestColumns, 'permission_decision_id')?.notnull).toBe(0);

    const approvalRecordColumns = tableColumns(database, 'approval_records');
    expect(approvalRecordColumns.map((column) => column.name)).toEqual([
      'approval_record_id',
      'approval_request_id',
      'tool_use_id',
      'tool_call_id',
      'run_id',
      'step_id',
      'decision',
      'scope',
      'decided_by',
      'decided_at',
      'record_json',
    ]);
    for (const requiredColumn of [
      'approval_request_id',
      'tool_use_id',
      'tool_call_id',
      'run_id',
      'step_id',
      'decision',
      'scope',
      'decided_by',
      'decided_at',
      'record_json',
    ]) {
      expect(columnByName(approvalRecordColumns, requiredColumn)?.notnull).toBe(1);
    }

    expect(foreignKeys(database, 'tool_uses')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'model_step_id', table: 'model_steps', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', on_delete: 'CASCADE' }),
    ]));
    expect(foreignKeys(database, 'model_steps')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'run_id', table: 'runs', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'step_id', table: 'run_steps', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'tool_calls')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_use_id', table: 'tool_uses', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'action_id', table: 'run_actions', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'tool_results')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_use_id', table: 'tool_uses', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'permission_decisions')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_use_id', table: 'tool_uses', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'approval_requests')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_use_id', table: 'tool_uses', on_delete: 'CASCADE' }),
      expect.objectContaining({
        from: 'permission_decision_id',
        table: 'permission_decisions',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'approval_records')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_use_id', table: 'tool_uses', on_delete: 'CASCADE' }),
    ]));
  });

  it('archives incompatible legacy tool persistence tables before creating target schema', () => {
    const database = createTestDb();
    seedLegacyToolPersistenceSchema(database);

    migrateDatabase(database);
    migrateDatabase(database);

    const toolCallColumns = tableColumns(database, 'tool_calls');
    expect(toolCallColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'tool_use_id',
      'action_id',
      'result_preview',
    ]));
    expect(columnByName(toolCallColumns, 'tool_use_id')?.notnull).toBe(1);
    expect(columnByName(toolCallColumns, 'action_id')?.notnull).toBe(0);

    expect(tableExists(database, 'tool_calls_legacy_05')).toBe(true);
    expect(tableExists(database, 'tool_policy_decisions_legacy_05')).toBe(true);
    expect(tableExists(database, 'approval_requests_legacy_05')).toBe(true);
    expect(tableExists(database, 'approval_records_legacy_05')).toBe(true);
    expect(tableExists(database, 'tool_observations_legacy_05')).toBe(true);

    const legacyToolCall = database
      .prepare('SELECT tool_call_id, action_id FROM tool_calls_legacy_05')
      .get() as { tool_call_id: string; action_id: string };
    expect(legacyToolCall).toEqual({
      tool_call_id: 'tool-call:legacy',
      action_id: 'action:legacy',
    });

    const approvalRequestColumns = tableColumns(database, 'approval_requests');
    expect(approvalRequestColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'tool_use_id',
      'permission_decision_id',
    ]));
    const approvalRecordColumns = tableColumns(database, 'approval_records');
    expect(approvalRecordColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'tool_use_id',
    ]));

    const indexes = database
      .prepare(`
        SELECT name, tbl_name
        FROM sqlite_master
        WHERE type = 'index'
        AND name IN (
          'idx_tool_calls_run_id',
          'idx_tool_calls_status',
          'idx_approval_requests_tool_call_id',
          'idx_tool_observations_tool_call_id'
        )
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string; tbl_name: string }>;

    expect(indexes).toEqual([
      { name: 'idx_approval_requests_tool_call_id', tbl_name: 'approval_requests' },
      { name: 'idx_tool_calls_run_id', tbl_name: 'tool_calls' },
      { name: 'idx_tool_calls_status', tbl_name: 'tool_calls' },
      { name: 'idx_tool_observations_tool_call_id', tbl_name: 'tool_observations' },
    ]);
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

  it('creates projects table and indexes', () => {
    const database = createTestDb();

    migrateDatabase(database);

    const columns = database
      .prepare('PRAGMA table_info(projects)')
      .all() as Array<{ name: string; notnull: 0 | 1; pk: 0 | 1 }>;

    expect(columns.map((column) => column.name)).toEqual([
      'project_id',
      'name',
      'repo_path',
      'repo_path_key',
      'status',
      'created_at',
      'last_opened_at',
    ]);
    expect(columns.find((column) => column.name === 'project_id')?.pk).toBe(1);
    expect(columns.find((column) => column.name === 'repo_path')?.notnull).toBe(1);
    expect(columns.find((column) => column.name === 'repo_path_key')?.notnull).toBe(1);

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_projects_last_opened_at',
      'idx_projects_status',
      'idx_projects_repo_path_key',
    ]));
  });

  it('does not create active agent-prefixed session run tables or indexes', () => {
    const source = readFileSync('packages/db/schema/migrations.ts', 'utf8');

    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS agent_(sessions|runs|steps|actions|observations|context_baselines|run_mode_snapshots|run_source_plans|checkpoints|resume_requests|cancel_requests|retry_requests)/);
    expect(source).not.toMatch(/CREATE INDEX IF NOT EXISTS idx_agent_(runs|steps|actions|observations|context|run_mode|run_source|checkpoints|resume|cancel|retry)/);
  });
});
