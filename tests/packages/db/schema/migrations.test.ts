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
): Array<{ name: string; type: string; notnull: 0 | 1; pk: 0 | 1 }> {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string; type: string; notnull: 0 | 1; pk: 0 | 1 }>;
}

function columnByName(
  columns: Array<{ name: string; type: string; notnull: 0 | 1; pk: 0 | 1 }>,
  name: string,
): { name: string; type: string; notnull: 0 | 1; pk: 0 | 1 } | undefined {
  return columns.find((column) => column.name === name);
}

function foreignKeys(
  database: Database.Database,
  tableName: string,
): Array<{ from: string; table: string; to: string; on_delete: string }> {
  return database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as Array<{ from: string; table: string; to: string; on_delete: string }>;
}

function indexNames(database: Database.Database): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
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

function seedActivePathOwnershipBase(database: Database.Database): void {
  database.exec(`
    INSERT INTO sessions (
      session_id,
      title,
      status,
      created_at,
      updated_at
    ) VALUES
      ('session-a', 'Session A', 'active', '2026-05-31T10:00:00.000Z', '2026-05-31T10:00:00.000Z'),
      ('session-b', 'Session B', 'active', '2026-05-31T10:00:00.000Z', '2026-05-31T10:00:00.000Z');

    INSERT INTO runs (
      run_id,
      session_id,
      permission_mode,
      goal,
      status,
      created_at
    ) VALUES
      ('run-a', 'session-a', 'chat', 'A', 'completed', '2026-05-31T10:01:00.000Z'),
      ('run-b', 'session-b', 'chat', 'B', 'completed', '2026-05-31T10:01:00.000Z');

    INSERT INTO session_source_entries (
      source_entry_id,
      session_id,
      source_kind,
      source_id,
      source_ref_json,
      created_at
    ) VALUES
      (
        'source-a-root',
        'session-a',
        'session_message',
        'message-a-root',
        '{"sourceKind":"session_message","sourceId":"message-a-root"}',
        '2026-05-31T10:02:00.000Z'
      ),
      (
        'source-b-root',
        'session-b',
        'session_message',
        'message-b-root',
        '{"sourceKind":"session_message","sourceId":"message-b-root"}',
        '2026-05-31T10:02:00.000Z'
      );
  `);
}

function countRows(database: Database.Database, tableName: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
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
      'tool_executions',
      'tool_observations',
      'tool_results',
      'permission_decisions',
      'timeline_messages',
      'timeline_run_commits',
      'timeline_commit_diagnostics',
    ]));

    const runColumns = tableColumns(database, 'runs').map((column) => column.name);
    expect(runColumns).toEqual(expect.arrayContaining([
      'permission_mode',
      'permission_snapshot_ref',
    ]));
    expect(runColumns).not.toEqual(expect.arrayContaining([
      'mode_snapshot_ref',
    ]));

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_run_actions_step_id',
      'idx_run_observations_run_id',
      'idx_runs_session_id',
      'idx_run_steps_run_id',
      'idx_approval_requests_tool_execution_id',
      'idx_model_steps_run_id',
      'idx_session_messages_session_id',
      'idx_runtime_events_run_sequence',
      'idx_tool_calls_run_id',
      'idx_tool_calls_model_step_id',
      'idx_tool_executions_run_id',
      'idx_tool_executions_status',
      'idx_tool_executions_tool_call_id',
      'idx_tool_observations_tool_execution_id',
      'idx_tool_results_tool_call_id',
      'idx_permission_decisions_tool_call_id',
      'idx_timeline_messages_session_order',
    ]));
  });

  it('creates session compaction table, foreign key, and indexes', () => {
    const database = createTestDb();

    migrateDatabase(database);

    expect(tableExists(database, 'session_compactions')).toBe(true);

    const columns = tableColumns(database, 'session_compactions');
    expect(columns.map((column) => column.name)).toEqual([
      'compaction_id',
      'session_id',
      'summary',
      'first_kept_source_ref_json',
      'tokens_before',
      'trigger_reason',
      'status',
      'created_at',
      'metadata_json',
    ]);

    expect(columnByName(columns, 'compaction_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    expect(columnByName(columns, 'session_id')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'summary')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'first_kept_source_ref_json')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'tokens_before')).toMatchObject({
      type: 'INTEGER',
      notnull: 1,
    });
    expect(columnByName(columns, 'trigger_reason')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'status')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'created_at')).toMatchObject({
      type: 'TEXT',
      notnull: 1,
    });
    expect(columnByName(columns, 'metadata_json')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
    });

    expect(foreignKeys(database, 'session_compactions')).toEqual([
      expect.objectContaining({
        table: 'sessions',
        from: 'session_id',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
    ]);

    expect(indexNames(database)).toEqual(expect.arrayContaining([
      'idx_session_compactions_session_created',
      'idx_session_compactions_session_status_created',
    ]));
  });

  it('creates session active path tables, foreign keys, and indexes', () => {
    const database = createTestDb();

    migrateDatabase(database);

    expect(tableExists(database, 'session_source_entries')).toBe(true);
    expect(tableExists(database, 'session_active_leaves')).toBe(true);
    expect(tableExists(database, 'session_branch_markers')).toBe(true);
    expect(tableExists(database, 'session_retry_attempts')).toBe(true);
    expect(tableExists(database, 'session_interrupted_run_markers')).toBe(true);

    const sourceEntryColumns = tableColumns(database, 'session_source_entries');
    expect(sourceEntryColumns.map((column) => column.name)).toEqual([
      'source_entry_id',
      'session_id',
      'parent_source_entry_id',
      'source_kind',
      'source_id',
      'source_uri',
      'source_ref_json',
      'created_at',
      'metadata_json',
    ]);
    expect(columnByName(sourceEntryColumns, 'source_entry_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    for (const requiredColumn of [
      'session_id',
      'source_kind',
      'source_id',
      'source_ref_json',
      'created_at',
    ]) {
      expect(columnByName(sourceEntryColumns, requiredColumn)?.notnull).toBe(1);
    }
    for (const nullableColumn of [
      'parent_source_entry_id',
      'source_uri',
      'metadata_json',
    ]) {
      expect(columnByName(sourceEntryColumns, nullableColumn)?.notnull).toBe(0);
    }

    const activeLeafColumns = tableColumns(database, 'session_active_leaves');
    expect(activeLeafColumns.map((column) => column.name)).toEqual([
      'session_id',
      'leaf_source_entry_id',
      'updated_at',
      'reason',
      'metadata_json',
    ]);
    expect(columnByName(activeLeafColumns, 'session_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    expect(columnByName(activeLeafColumns, 'leaf_source_entry_id')?.notnull).toBe(0);
    expect(columnByName(activeLeafColumns, 'updated_at')?.notnull).toBe(1);
    expect(columnByName(activeLeafColumns, 'reason')?.notnull).toBe(1);
    expect(columnByName(activeLeafColumns, 'metadata_json')?.notnull).toBe(0);

    const branchMarkerColumns = tableColumns(database, 'session_branch_markers');
    expect(branchMarkerColumns.map((column) => column.name)).toEqual([
      'branch_marker_id',
      'session_id',
      'previous_leaf_source_entry_id',
      'target_leaf_source_entry_id',
      'selected_source_ref_json',
      'seed_source_ref_json',
      'reason',
      'created_at',
      'metadata_json',
      'branch_marker_json',
    ]);
    expect(columnByName(branchMarkerColumns, 'branch_marker_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    for (const requiredColumn of [
      'session_id',
      'selected_source_ref_json',
      'reason',
      'created_at',
      'branch_marker_json',
    ]) {
      expect(columnByName(branchMarkerColumns, requiredColumn)?.notnull).toBe(1);
    }
    for (const nullableColumn of [
      'previous_leaf_source_entry_id',
      'target_leaf_source_entry_id',
      'seed_source_ref_json',
      'metadata_json',
    ]) {
      expect(columnByName(branchMarkerColumns, nullableColumn)?.notnull).toBe(0);
    }

    const retryAttemptColumns = tableColumns(database, 'session_retry_attempts');
    expect(retryAttemptColumns.map((column) => column.name)).toEqual([
      'retry_attempt_id',
      'session_id',
      'run_id',
      'base_run_id',
      'base_source_entry_id',
      'attempt_number',
      'retry_kind',
      'reason',
      'status',
      'retryable',
      'created_at',
      'completed_at',
      'error_json',
      'metadata_json',
      'attempt_json',
    ]);
    expect(columnByName(retryAttemptColumns, 'retry_attempt_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    for (const requiredColumn of [
      'session_id',
      'run_id',
      'attempt_number',
      'retry_kind',
      'reason',
      'status',
      'retryable',
      'created_at',
      'attempt_json',
    ]) {
      expect(columnByName(retryAttemptColumns, requiredColumn)?.notnull).toBe(1);
    }
    for (const nullableColumn of [
      'base_run_id',
      'base_source_entry_id',
      'completed_at',
      'error_json',
      'metadata_json',
    ]) {
      expect(columnByName(retryAttemptColumns, nullableColumn)?.notnull).toBe(0);
    }

    const interruptedMarkerColumns = tableColumns(database, 'session_interrupted_run_markers');
    expect(interruptedMarkerColumns.map((column) => column.name)).toEqual([
      'interrupted_marker_id',
      'session_id',
      'run_id',
      'previous_status',
      'reason',
      'marked_at',
      'metadata_json',
      'marker_json',
    ]);
    expect(columnByName(interruptedMarkerColumns, 'interrupted_marker_id')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      pk: 1,
    });
    for (const requiredColumn of [
      'session_id',
      'run_id',
      'previous_status',
      'reason',
      'marked_at',
      'marker_json',
    ]) {
      expect(columnByName(interruptedMarkerColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(interruptedMarkerColumns, 'metadata_json')?.notnull).toBe(0);

    expect(foreignKeys(database, 'session_source_entries')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'session_id',
        table: 'sessions',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'parent_source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'session_active_leaves')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'session_id',
        table: 'sessions',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'leaf_source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'session_branch_markers')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'session_id',
        table: 'sessions',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'previous_leaf_source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({
        from: 'target_leaf_source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'session_retry_attempts')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'session_id',
        table: 'sessions',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'run_id',
        table: 'runs',
        to: 'run_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'base_run_id',
        table: 'runs',
        to: 'run_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({
        from: 'base_source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'session_interrupted_run_markers')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'session_id',
        table: 'sessions',
        to: 'session_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'run_id',
        table: 'runs',
        to: 'run_id',
        on_delete: 'CASCADE',
      }),
    ]));

    expect(indexNames(database)).toEqual(expect.arrayContaining([
      'idx_session_source_entries_session_parent',
      'idx_session_source_entries_session_ref',
      'idx_session_source_entries_parent',
      'idx_session_active_leaves_leaf',
      'idx_session_branch_markers_session_created',
      'idx_session_retry_attempts_run_attempt',
      'idx_session_retry_attempts_session_created',
      'idx_session_interrupted_run_markers_run',
      'idx_session_interrupted_run_markers_session',
    ]));
  });

  it('enforces session ownership for active path references', () => {
    const database = createTestDb();
    migrateDatabase(database);
    seedActivePathOwnershipBase(database);

    database.prepare(`
      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        parent_source_entry_id,
        source_kind,
        source_id,
        source_ref_json,
        created_at
      ) VALUES (
        'source-a-child',
        'session-a',
        'source-a-root',
        'session_message',
        'message-a-child',
        '{"sourceKind":"session_message","sourceId":"message-a-child"}',
        '2026-05-31T10:03:00.000Z'
      )
    `).run();
    expect(() => database.prepare(`
      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        parent_source_entry_id,
        source_kind,
        source_id,
        source_ref_json,
        created_at
      ) VALUES (
        'source-a-cross-parent',
        'session-a',
        'source-b-root',
        'session_message',
        'message-a-cross-parent',
        '{"sourceKind":"session_message","sourceId":"message-a-cross-parent"}',
        '2026-05-31T10:04:00.000Z'
      )
    `).run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_source_entries
        SET parent_source_entry_id = 'source-b-root'
        WHERE source_entry_id = 'source-a-child'
      `)
      .run()).toThrow();

    database.prepare(`
      INSERT INTO session_active_leaves (
        session_id,
        leaf_source_entry_id,
        updated_at,
        reason
      ) VALUES (
        'session-a',
        'source-a-child',
        '2026-05-31T10:05:00.000Z',
        'source_appended'
      )
    `).run();
    expect(() => database.prepare(`
      INSERT INTO session_active_leaves (
        session_id,
        leaf_source_entry_id,
        updated_at,
        reason
      ) VALUES (
        'session-b',
        'source-a-child',
        '2026-05-31T10:05:00.000Z',
        'source_appended'
      )
    `).run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_active_leaves
        SET leaf_source_entry_id = 'source-b-root'
        WHERE session_id = 'session-a'
      `)
      .run()).toThrow();

    database.prepare(`
      INSERT INTO session_branch_markers (
        branch_marker_id,
        session_id,
        previous_leaf_source_entry_id,
        target_leaf_source_entry_id,
        selected_source_ref_json,
        reason,
        created_at,
        branch_marker_json
      ) VALUES (
        'branch-a-valid',
        'session-a',
        'source-a-child',
        'source-a-root',
        '{"sourceKind":"session_message","sourceId":"message-a-root"}',
        'branch_from_user_message',
        '2026-05-31T10:06:00.000Z',
        '{}'
      )
    `).run();
    expect(() => database.prepare(`
      INSERT INTO session_branch_markers (
        branch_marker_id,
        session_id,
        previous_leaf_source_entry_id,
        target_leaf_source_entry_id,
        selected_source_ref_json,
        reason,
        created_at,
        branch_marker_json
      ) VALUES (
        'branch-a-cross-previous',
        'session-a',
        'source-b-root',
        'source-a-root',
        '{"sourceKind":"session_message","sourceId":"message-a-root"}',
        'branch_from_user_message',
        '2026-05-31T10:07:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database.prepare(`
      INSERT INTO session_branch_markers (
        branch_marker_id,
        session_id,
        previous_leaf_source_entry_id,
        target_leaf_source_entry_id,
        selected_source_ref_json,
        reason,
        created_at,
        branch_marker_json
      ) VALUES (
        'branch-a-cross-target',
        'session-a',
        'source-a-child',
        'source-b-root',
        '{"sourceKind":"session_message","sourceId":"message-a-root"}',
        'branch_from_user_message',
        '2026-05-31T10:08:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_branch_markers
        SET previous_leaf_source_entry_id = 'source-b-root'
        WHERE branch_marker_id = 'branch-a-valid'
      `)
      .run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_branch_markers
        SET target_leaf_source_entry_id = 'source-b-root'
        WHERE branch_marker_id = 'branch-a-valid'
      `)
      .run()).toThrow();

    database.prepare(`
      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_run_id,
        base_source_entry_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-valid',
        'session-a',
        'run-a',
        'run-a',
        'source-a-child',
        1,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T10:09:00.000Z',
        '{}'
      )
    `).run();
    expect(() => database.prepare(`
      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-cross-run',
        'session-a',
        'run-b',
        2,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T10:10:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database.prepare(`
      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_run_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-cross-base-run',
        'session-a',
        'run-a',
        'run-b',
        3,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T10:11:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database.prepare(`
      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_source_entry_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-cross-source',
        'session-a',
        'run-a',
        'source-b-root',
        4,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T10:12:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_retry_attempts
        SET run_id = 'run-b'
        WHERE retry_attempt_id = 'retry-a-valid'
      `)
      .run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_retry_attempts
        SET base_run_id = 'run-b'
        WHERE retry_attempt_id = 'retry-a-valid'
      `)
      .run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_retry_attempts
        SET base_source_entry_id = 'source-b-root'
        WHERE retry_attempt_id = 'retry-a-valid'
      `)
      .run()).toThrow();

    database.prepare(`
      INSERT INTO session_interrupted_run_markers (
        interrupted_marker_id,
        session_id,
        run_id,
        previous_status,
        reason,
        marked_at,
        marker_json
      ) VALUES (
        'interrupted-a-valid',
        'session-a',
        'run-a',
        'running',
        'app_restarted',
        '2026-05-31T10:13:00.000Z',
        '{}'
      )
    `).run();
    expect(() => database.prepare(`
      INSERT INTO session_interrupted_run_markers (
        interrupted_marker_id,
        session_id,
        run_id,
        previous_status,
        reason,
        marked_at,
        marker_json
      ) VALUES (
        'interrupted-a-cross-run',
        'session-a',
        'run-b',
        'running',
        'app_restarted',
        '2026-05-31T10:14:00.000Z',
        '{}'
      )
    `).run()).toThrow();
    expect(() => database
      .prepare(`
        UPDATE session_interrupted_run_markers
        SET run_id = 'run-b'
        WHERE interrupted_marker_id = 'interrupted-a-valid'
      `)
      .run()).toThrow();
  });

  it('rejects moving referenced active path sources and runs across sessions', () => {
    const database = createTestDb();
    migrateDatabase(database);
    seedActivePathOwnershipBase(database);

    database.exec(`
      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        source_kind,
        source_id,
        source_ref_json,
        created_at
      ) VALUES
        (
          'source-a-parent-owner',
          'session-a',
          'session_message',
          'message-a-parent-owner',
          '{"sourceKind":"session_message","sourceId":"message-a-parent-owner"}',
          '2026-05-31T11:00:00.000Z'
        ),
        (
          'source-a-leaf-owner',
          'session-a',
          'session_message',
          'message-a-leaf-owner',
          '{"sourceKind":"session_message","sourceId":"message-a-leaf-owner"}',
          '2026-05-31T11:01:00.000Z'
        ),
        (
          'source-a-branch-previous-owner',
          'session-a',
          'session_message',
          'message-a-branch-previous-owner',
          '{"sourceKind":"session_message","sourceId":"message-a-branch-previous-owner"}',
          '2026-05-31T11:02:00.000Z'
        ),
        (
          'source-a-branch-target-owner',
          'session-a',
          'session_message',
          'message-a-branch-target-owner',
          '{"sourceKind":"session_message","sourceId":"message-a-branch-target-owner"}',
          '2026-05-31T11:03:00.000Z'
        ),
        (
          'source-a-retry-base-owner',
          'session-a',
          'session_message',
          'message-a-retry-base-owner',
          '{"sourceKind":"session_message","sourceId":"message-a-retry-base-owner"}',
          '2026-05-31T11:04:00.000Z'
        );

      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        parent_source_entry_id,
        source_kind,
        source_id,
        source_ref_json,
        created_at
      ) VALUES (
        'source-a-child-owner',
        'session-a',
        'source-a-parent-owner',
        'session_message',
        'message-a-child-owner',
        '{"sourceKind":"session_message","sourceId":"message-a-child-owner"}',
        '2026-05-31T11:05:00.000Z'
      );

      INSERT INTO session_active_leaves (
        session_id,
        leaf_source_entry_id,
        updated_at,
        reason
      ) VALUES (
        'session-a',
        'source-a-leaf-owner',
        '2026-05-31T11:06:00.000Z',
        'source_appended'
      );

      INSERT INTO session_branch_markers (
        branch_marker_id,
        session_id,
        previous_leaf_source_entry_id,
        target_leaf_source_entry_id,
        selected_source_ref_json,
        reason,
        created_at,
        branch_marker_json
      ) VALUES (
        'branch-a-owner-valid',
        'session-a',
        'source-a-branch-previous-owner',
        'source-a-branch-target-owner',
        '{"sourceKind":"session_message","sourceId":"message-a-branch-target-owner"}',
        'branch_from_user_message',
        '2026-05-31T11:07:00.000Z',
        '{}'
      );

      INSERT INTO runs (
        run_id,
        session_id,
        permission_mode,
        goal,
        status,
        created_at
      ) VALUES
        (
          'run-a-retry-current-owner',
          'session-a',
          'chat',
          'retry current',
          'failed',
          '2026-05-31T11:08:00.000Z'
        ),
        (
          'run-a-retry-base-owner',
          'session-a',
          'chat',
          'retry base',
          'failed',
          '2026-05-31T11:09:00.000Z'
        ),
        (
          'run-a-interrupted-owner',
          'session-a',
          'chat',
          'interrupted',
          'running',
          '2026-05-31T11:10:00.000Z'
        );

      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_source_entry_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-source-owner',
        'session-a',
        'run-a',
        'source-a-retry-base-owner',
        1,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T11:11:00.000Z',
        '{}'
      );

      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-current-run-owner',
        'session-a',
        'run-a-retry-current-owner',
        2,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T11:12:00.000Z',
        '{}'
      );

      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_run_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        attempt_json
      ) VALUES (
        'retry-a-base-run-owner',
        'session-a',
        'run-a',
        'run-a-retry-base-owner',
        3,
        'manual_retry',
        'failed',
        'pending',
        1,
        '2026-05-31T11:13:00.000Z',
        '{}'
      );

      INSERT INTO session_interrupted_run_markers (
        interrupted_marker_id,
        session_id,
        run_id,
        previous_status,
        reason,
        marked_at,
        marker_json
      ) VALUES (
        'interrupted-a-run-owner',
        'session-a',
        'run-a-interrupted-owner',
        'running',
        'app_restarted',
        '2026-05-31T11:14:00.000Z',
        '{}'
      );
    `);

    for (const sourceEntryId of [
      'source-a-parent-owner',
      'source-a-leaf-owner',
      'source-a-branch-previous-owner',
      'source-a-branch-target-owner',
      'source-a-retry-base-owner',
    ]) {
      expect(() => database
        .prepare(`
          UPDATE session_source_entries
          SET session_id = 'session-b'
          WHERE source_entry_id = ?
        `)
        .run(sourceEntryId)).toThrow();
    }

    for (const runId of [
      'run-a-retry-current-owner',
      'run-a-retry-base-owner',
      'run-a-interrupted-owner',
    ]) {
      expect(() => database
        .prepare(`
          UPDATE runs
          SET session_id = 'session-b'
          WHERE run_id = ?
        `)
        .run(runId)).toThrow();
    }
  });

  it('does not backfill old session records into active path tables', () => {
    const database = createTestDb();

    database.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace_id TEXT,
        workspace_path TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        summary TEXT,
        metadata_json TEXT
      );

      CREATE TABLE session_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        metadata_json TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE session_compactions (
        compaction_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        first_kept_source_ref_json TEXT NOT NULL,
        tokens_before INTEGER NOT NULL,
        trigger_reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trigger_message_id TEXT,
        agent_definition_id TEXT,
        agent_config_snapshot_ref TEXT,
        mode TEXT NOT NULL,
        mode_snapshot_ref TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        error_json TEXT,
        source_plan_id TEXT,
        policy_snapshot_ref TEXT,
        metadata_json TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        FOREIGN KEY(trigger_message_id) REFERENCES session_messages(message_id) ON DELETE SET NULL
      );

      INSERT INTO sessions (
        session_id,
        title,
        status,
        created_at,
        updated_at
      ) VALUES (
        'session-old',
        'Old session',
        'active',
        '2026-05-30T10:00:00.000Z',
        '2026-05-30T10:00:00.000Z'
      );

      INSERT INTO session_messages (
        message_id,
        session_id,
        run_id,
        role,
        content,
        status,
        created_at,
        completed_at
      ) VALUES (
        'message-old',
        'session-old',
        'run-old',
        'user',
        'old message',
        'completed',
        '2026-05-30T10:01:00.000Z',
        '2026-05-30T10:01:01.000Z'
      );

      INSERT INTO runs (
        run_id,
        session_id,
        trigger_message_id,
        mode,
        goal,
        status,
        created_at
      ) VALUES (
        'run-old',
        'session-old',
        'message-old',
        'chat',
        'old goal',
        'completed',
        '2026-05-30T10:02:00.000Z'
      );

      INSERT INTO session_compactions (
        compaction_id,
        session_id,
        summary,
        first_kept_source_ref_json,
        tokens_before,
        trigger_reason,
        status,
        created_at
      ) VALUES (
        'compaction-old',
        'session-old',
        'old summary',
        '{"sourceKind":"session_message","sourceId":"message-old"}',
        1200,
        'budget_pressure',
        'completed',
        '2026-05-30T10:03:00.000Z'
      );
    `);

    migrateDatabase(database);

    expect(database.prepare('SELECT session_id, title FROM sessions').get()).toEqual({
      session_id: 'session-old',
      title: 'Old session',
    });
    expect(database.prepare('SELECT message_id, content FROM session_messages').get()).toEqual({
      message_id: 'message-old',
      content: 'old message',
    });
    expect(database.prepare('SELECT run_id, goal FROM runs').get()).toEqual({
      run_id: 'run-old',
      goal: 'old goal',
    });
    expect(database.prepare('SELECT compaction_id, summary FROM session_compactions').get()).toEqual({
      compaction_id: 'compaction-old',
      summary: 'old summary',
    });
    expect(countRows(database, 'session_source_entries')).toBe(0);
    expect(countRows(database, 'session_active_leaves')).toBe(0);
    expect(countRows(database, 'session_branch_markers')).toBe(0);
    expect(countRows(database, 'session_retry_attempts')).toBe(0);
    expect(countRows(database, 'session_interrupted_run_markers')).toBe(0);
  });

  it('creates Plan 1 tool call and execution schema columns', () => {
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

    const toolCallColumns = tableColumns(database, 'tool_calls');
    expect(toolCallColumns.map((column) => column.name)).toEqual([
      'tool_call_id',
      'run_id',
      'model_step_id',
      'provider_tool_call_id',
      'tool_name',
      'input_json',
      'input_preview_json',
      'status',
      'created_at',
      'completed_at',
      'error_json',
      'metadata_json',
      'tool_call_json',
    ]);
    for (const requiredColumn of [
      'run_id',
      'model_step_id',
      'provider_tool_call_id',
      'tool_name',
      'input_json',
      'input_preview_json',
      'status',
      'created_at',
      'tool_call_json',
    ]) {
      expect(columnByName(toolCallColumns, requiredColumn)?.notnull).toBe(1);
    }

    const toolExecutionColumns = tableColumns(database, 'tool_executions');
    expect(toolExecutionColumns.map((column) => column.name)).toEqual([
      'tool_execution_id',
      'tool_call_id',
      'run_id',
      'step_id',
      'action_id',
      'tool_name',
      'input_json',
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
      'tool_execution_json',
    ]);
    for (const requiredColumn of [
      'tool_call_id',
      'run_id',
      'step_id',
      'tool_name',
      'input_json',
      'input_preview_json',
      'capabilities_json',
      'risk_level',
      'side_effect',
      'status',
      'requested_at',
      'tool_execution_json',
    ]) {
      expect(columnByName(toolExecutionColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(toolExecutionColumns, 'action_id')?.notnull).toBe(0);

    const toolResultColumns = tableColumns(database, 'tool_results');
    expect(toolResultColumns.map((column) => column.name)).toEqual([
      'tool_result_id',
      'tool_call_id',
      'tool_execution_id',
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
      'tool_call_id',
      'run_id',
      'kind',
      'redaction_state',
      'created_at',
      'result_json',
    ]) {
      expect(columnByName(toolResultColumns, requiredColumn)?.notnull).toBe(1);
    }
    expect(columnByName(toolResultColumns, 'tool_execution_id')?.notnull).toBe(0);

    const permissionDecisionColumns = tableColumns(database, 'permission_decisions');
    expect(permissionDecisionColumns.map((column) => column.name)).toEqual([
      'permission_decision_id',
      'tool_call_id',
      'tool_execution_id',
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
      'tool_call_id',
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
    expect(columnByName(permissionDecisionColumns, 'tool_execution_id')?.notnull).toBe(0);

    const approvalRequestColumns = tableColumns(database, 'approval_requests');
    expect(approvalRequestColumns.map((column) => column.name)).toEqual([
      'approval_request_id',
      'tool_call_id',
      'tool_execution_id',
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
      'tool_call_id',
      'tool_execution_id',
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
      'tool_call_id',
      'tool_execution_id',
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
      'tool_call_id',
      'tool_execution_id',
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

    expect(foreignKeys(database, 'model_steps')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'run_id', table: 'runs', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'step_id', table: 'run_steps', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'tool_calls')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'model_step_id', table: 'model_steps', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', on_delete: 'CASCADE' }),
    ]));
    expect(foreignKeys(database, 'tool_executions')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'action_id', table: 'run_actions', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'tool_results')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_execution_id', table: 'tool_executions', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'permission_decisions')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_execution_id', table: 'tool_executions', on_delete: 'SET NULL' }),
    ]));
    expect(foreignKeys(database, 'approval_requests')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_execution_id', table: 'tool_executions', on_delete: 'CASCADE' }),
      expect.objectContaining({
        from: 'permission_decision_id',
        table: 'permission_decisions',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'approval_records')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_execution_id', table: 'tool_executions', on_delete: 'CASCADE' }),
    ]));
  });

  it('archives incompatible legacy tool persistence tables before creating target schema', () => {
    const database = createTestDb();
    seedLegacyToolPersistenceSchema(database);

    migrateDatabase(database);
    migrateDatabase(database);

    const toolCallColumns = tableColumns(database, 'tool_calls');
    expect(toolCallColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'model_step_id',
      'provider_tool_call_id',
      'tool_call_json',
    ]));
    expect(columnByName(toolCallColumns, 'provider_tool_call_id')?.notnull).toBe(1);
    expect(tableExists(database, 'tool_uses')).toBe(false);

    expect(tableExists(database, 'tool_calls_legacy_08')).toBe(true);
    expect(tableExists(database, 'tool_policy_decisions_legacy_05')).toBe(true);
    expect(tableExists(database, 'approval_requests_legacy_08')).toBe(true);
    expect(tableExists(database, 'approval_records_legacy_08')).toBe(true);
    expect(tableExists(database, 'tool_observations_legacy_08')).toBe(true);

    const legacyToolCall = database
      .prepare('SELECT tool_call_id, action_id FROM tool_calls_legacy_08')
      .get() as { tool_call_id: string; action_id: string };
    expect(legacyToolCall).toEqual({
      tool_call_id: 'tool-call:legacy',
      action_id: 'action:legacy',
    });

    const approvalRequestColumns = tableColumns(database, 'approval_requests');
    expect(approvalRequestColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'tool_execution_id',
      'permission_decision_id',
    ]));
    const approvalRecordColumns = tableColumns(database, 'approval_records');
    expect(approvalRecordColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'tool_execution_id',
    ]));

    const indexes = database
      .prepare(`
        SELECT name, tbl_name
        FROM sqlite_master
        WHERE type = 'index'
        AND name IN (
          'idx_tool_calls_run_id',
          'idx_tool_executions_status',
          'idx_approval_requests_tool_execution_id',
          'idx_tool_observations_tool_execution_id'
        )
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string; tbl_name: string }>;

    expect(indexes).toEqual([
      { name: 'idx_approval_requests_tool_execution_id', tbl_name: 'approval_requests' },
      { name: 'idx_tool_calls_run_id', tbl_name: 'tool_calls' },
      { name: 'idx_tool_executions_status', tbl_name: 'tool_executions' },
      { name: 'idx_tool_observations_tool_execution_id', tbl_name: 'tool_observations' },
    ]);
  });

  it('creates permission snapshot and implementation plan tables', () => {
    const database = createTestDb();
    migrateDatabase(database);

    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      AND name IN (
        'permission_snapshots',
        'implementation_plan_artifacts',
        'run_source_plans'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      'implementation_plan_artifacts',
      'permission_snapshots',
      'run_source_plans',
    ]);

    expect(tables.map((row) => row.name)).not.toContain('run_mode_snapshots');

    expect(tableColumns(database, 'permission_snapshots').map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'permission_snapshot_id',
        'run_id',
        'permission_label',
        'permission_mode_state_json',
        'permission_mode',
        'permission_source',
        'created_at',
        'metadata_json',
      ]),
    );
  });

  it('indexes permission snapshot and source plan lookup paths', () => {
    const database = createTestDb();
    migrateDatabase(database);

    const indexes = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index'
      AND name IN (
        'idx_permission_snapshots_run_id',
        'idx_implementation_plan_artifacts_producing_run_id',
        'idx_run_source_plans_source_plan_id'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_implementation_plan_artifacts_producing_run_id',
      'idx_permission_snapshots_run_id',
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
      'permission_snapshot_ref',
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

    expect(checkpointColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      'mode_snapshot_ref',
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

  it('creates workspace change persistence tables with expected columns, foreign keys, and indexes', () => {
    const database = createTestDb();
    migrateDatabase(database);

    for (const tableName of [
      'workspace_snapshot_contents',
      'workspace_change_sets',
      'workspace_checkpoints',
      'workspace_changed_files',
      'workspace_restore_requests',
      'workspace_restore_results',
      'workspace_restore_file_results',
    ]) {
      expect(tableExists(database, tableName)).toBe(true);
    }

    expect(tableColumns(database, 'workspace_snapshot_contents').map((column) => column.name)).toEqual([
      'content_ref_id',
      'session_id',
      'run_id',
      'project_path',
      'storage',
      'encoding',
      'sha256',
      'byte_length',
      'content_text',
      'created_at',
      'metadata_json',
    ]);
    expect(columnByName(tableColumns(database, 'workspace_snapshot_contents'), 'content_ref_id')).toMatchObject({
      type: 'TEXT',
      pk: 1,
    });

    expect(tableColumns(database, 'workspace_change_sets').map((column) => column.name)).toEqual([
      'change_set_id',
      'session_id',
      'run_id',
      'step_id',
      'source_entry_id',
      'response_message_id',
      'status',
      'changed_file_count',
      'created_at',
      'finalized_at',
      'metadata_json',
    ]);

    expect(tableColumns(database, 'workspace_checkpoints').map((column) => column.name)).toEqual([
      'workspace_checkpoint_id',
      'change_set_id',
      'session_id',
      'run_id',
      'step_id',
      'tool_call_id',
      'tool_execution_id',
      'source_entry_id',
      'response_message_id',
      'project_path',
      'before_exists',
      'before_content_ref_id',
      'before_hash',
      'before_byte_length',
      'created_at',
      'metadata_json',
    ]);

    expect(tableColumns(database, 'workspace_changed_files').map((column) => column.name)).toEqual([
      'changed_file_id',
      'change_set_id',
      'workspace_checkpoint_id',
      'session_id',
      'run_id',
      'step_id',
      'tool_call_id',
      'tool_execution_id',
      'source_entry_id',
      'response_message_id',
      'project_path',
      'change_kind',
      'restore_state',
      'before_exists',
      'before_content_ref_id',
      'before_hash',
      'before_byte_length',
      'after_exists',
      'after_content_ref_id',
      'after_hash',
      'after_byte_length',
      'created_at',
      'updated_at',
      'metadata_json',
    ]);

    expect(tableColumns(database, 'workspace_restore_requests').map((column) => column.name)).toEqual([
      'restore_request_id',
      'change_set_id',
      'session_id',
      'run_id',
      'requested_by',
      'status',
      'requested_at',
      'completed_at',
      'metadata_json',
    ]);

    expect(tableColumns(database, 'workspace_restore_results').map((column) => column.name)).toEqual([
      'restore_result_id',
      'restore_request_id',
      'change_set_id',
      'session_id',
      'run_id',
      'status',
      'restored_at',
      'error_json',
      'metadata_json',
    ]);

    expect(tableColumns(database, 'workspace_restore_file_results').map((column) => column.name)).toEqual([
      'restore_file_result_id',
      'restore_result_id',
      'changed_file_id',
      'project_path',
      'status',
      'conflict_reason',
      'error_json',
      'restored_at',
      'metadata_json',
    ]);

    expect(foreignKeys(database, 'workspace_snapshot_contents')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
    ]));
    expect(foreignKeys(database, 'workspace_change_sets')).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'step_id', table: 'run_steps', to: 'step_id', on_delete: 'SET NULL' }),
      expect.objectContaining({
        from: 'source_entry_id',
        table: 'session_source_entries',
        to: 'source_entry_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({
        from: 'response_message_id',
        table: 'session_messages',
        to: 'message_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'workspace_checkpoints')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'change_set_id',
        table: 'workspace_change_sets',
        to: 'change_set_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'tool_call_id', table: 'tool_calls', to: 'tool_call_id', on_delete: 'SET NULL' }),
      expect.objectContaining({
        from: 'tool_execution_id',
        table: 'tool_executions',
        to: 'tool_execution_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({
        from: 'before_content_ref_id',
        table: 'workspace_snapshot_contents',
        to: 'content_ref_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'workspace_changed_files')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'change_set_id',
        table: 'workspace_change_sets',
        to: 'change_set_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'workspace_checkpoint_id',
        table: 'workspace_checkpoints',
        to: 'workspace_checkpoint_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
      expect.objectContaining({
        from: 'before_content_ref_id',
        table: 'workspace_snapshot_contents',
        to: 'content_ref_id',
        on_delete: 'SET NULL',
      }),
      expect.objectContaining({
        from: 'after_content_ref_id',
        table: 'workspace_snapshot_contents',
        to: 'content_ref_id',
        on_delete: 'SET NULL',
      }),
    ]));
    expect(foreignKeys(database, 'workspace_restore_requests')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'change_set_id',
        table: 'workspace_change_sets',
        to: 'change_set_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
    ]));
    expect(foreignKeys(database, 'workspace_restore_results')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'restore_request_id',
        table: 'workspace_restore_requests',
        to: 'restore_request_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'change_set_id',
        table: 'workspace_change_sets',
        to: 'change_set_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({ from: 'session_id', table: 'sessions', to: 'session_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ from: 'run_id', table: 'runs', to: 'run_id', on_delete: 'CASCADE' }),
    ]));
    expect(foreignKeys(database, 'workspace_restore_file_results')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'restore_result_id',
        table: 'workspace_restore_results',
        to: 'restore_result_id',
        on_delete: 'CASCADE',
      }),
      expect.objectContaining({
        from: 'changed_file_id',
        table: 'workspace_changed_files',
        to: 'changed_file_id',
        on_delete: 'CASCADE',
      }),
    ]));

    expect(indexNames(database)).toEqual(expect.arrayContaining([
      'idx_workspace_snapshot_contents_session_run',
      'idx_workspace_snapshot_contents_run_path',
      'idx_workspace_change_sets_session_created',
      'idx_workspace_change_sets_run_created',
      'idx_workspace_checkpoints_change_set',
      'idx_workspace_checkpoints_run_path',
      'idx_workspace_checkpoints_tool_execution',
      'idx_workspace_changed_files_change_set',
      'idx_workspace_changed_files_run',
      'idx_workspace_changed_files_run_path',
      'idx_workspace_changed_files_restore_state',
      'idx_workspace_restore_requests_change_set',
      'idx_workspace_restore_results_request',
      'idx_workspace_restore_results_change_set',
      'idx_workspace_restore_file_results_result',
      'idx_workspace_restore_file_results_changed_file',
    ]));
  });

  it('cascades workspace change rows when deleting a session', () => {
    const database = createTestDb();
    database.pragma('foreign_keys = ON');
    migrateDatabase(database);

    database.exec(`
      INSERT INTO sessions (session_id, title, status, created_at, updated_at)
      VALUES ('session-workspace', 'Workspace changes', 'active', '2026-06-05T10:00:00.000Z', '2026-06-05T10:00:00.000Z');

      INSERT INTO runs (run_id, session_id, permission_mode, goal, status, created_at)
      VALUES ('run-workspace', 'session-workspace', 'chat', 'Change file', 'completed', '2026-06-05T10:01:00.000Z');

      INSERT INTO run_steps (step_id, run_id, kind, status)
      VALUES ('step-workspace', 'run-workspace', 'tool', 'succeeded');

      INSERT INTO session_messages (message_id, session_id, run_id, role, content, status, created_at)
      VALUES (
        'message-workspace',
        'session-workspace',
        'run-workspace',
        'assistant',
        'Changed src/index.ts',
        'completed',
        '2026-06-05T10:02:00.000Z'
      );

      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        source_kind,
        source_id,
        source_ref_json,
        created_at
      ) VALUES (
        'source-workspace',
        'session-workspace',
        'session_message',
        'message-workspace',
        '{"sourceKind":"session_message","sourceId":"message-workspace"}',
        '2026-06-05T10:02:00.000Z'
      );

      INSERT INTO model_steps (
        model_step_id,
        run_id,
        step_id,
        provider_id,
        model_id,
        status,
        started_at,
        model_step_json
      ) VALUES (
        'model-step-workspace',
        'run-workspace',
        'step-workspace',
        'openai-compatible',
        'gpt-5',
        'completed',
        '2026-06-05T10:02:30.000Z',
        '{}'
      );

      INSERT INTO tool_calls (
        tool_call_id,
        run_id,
        model_step_id,
        provider_tool_call_id,
        tool_name,
        input_json,
        input_preview_json,
        status,
        created_at,
        tool_call_json
      ) VALUES (
        'tool-call-workspace',
        'run-workspace',
        'model-step-workspace',
        'provider-tool-call-workspace',
        'write_file',
        '{}',
        '{}',
        'completed',
        '2026-06-05T10:03:00.000Z',
        '{}'
      );

      INSERT INTO tool_executions (
        tool_execution_id,
        tool_call_id,
        run_id,
        step_id,
        tool_name,
        input_json,
        input_preview_json,
        capabilities_json,
        risk_level,
        side_effect,
        status,
        requested_at,
        tool_execution_json
      ) VALUES (
        'tool-execution-workspace',
        'tool-call-workspace',
        'run-workspace',
        'step-workspace',
        'write_file',
        '{}',
        '{}',
        '["project_write"]',
        'medium',
        'write_file',
        'succeeded',
        '2026-06-05T10:03:01.000Z',
        '{}'
      );

      INSERT INTO workspace_snapshot_contents (
        content_ref_id,
        session_id,
        run_id,
        project_path,
        storage,
        encoding,
        sha256,
        byte_length,
        content_text,
        created_at
      ) VALUES
        (
          'snapshot-before',
          'session-workspace',
          'run-workspace',
          'src/index.ts',
          'sqlite_text',
          'utf8',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          6,
          'before',
          '2026-06-05T10:03:02.000Z'
        ),
        (
          'snapshot-after',
          'session-workspace',
          'run-workspace',
          'src/index.ts',
          'sqlite_text',
          'utf8',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          5,
          'after',
          '2026-06-05T10:03:03.000Z'
        );

      INSERT INTO workspace_change_sets (
        change_set_id,
        session_id,
        run_id,
        step_id,
        source_entry_id,
        response_message_id,
        status,
        changed_file_count,
        created_at
      ) VALUES (
        'change-set-workspace',
        'session-workspace',
        'run-workspace',
        'step-workspace',
        'source-workspace',
        'message-workspace',
        'finalized',
        1,
        '2026-06-05T10:03:04.000Z'
      );

      INSERT INTO workspace_checkpoints (
        workspace_checkpoint_id,
        change_set_id,
        session_id,
        run_id,
        step_id,
        tool_call_id,
        tool_execution_id,
        source_entry_id,
        response_message_id,
        project_path,
        before_exists,
        before_content_ref_id,
        before_hash,
        before_byte_length,
        created_at
      ) VALUES (
        'workspace-checkpoint',
        'change-set-workspace',
        'session-workspace',
        'run-workspace',
        'step-workspace',
        'tool-call-workspace',
        'tool-execution-workspace',
        'source-workspace',
        'message-workspace',
        'src/index.ts',
        1,
        'snapshot-before',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        6,
        '2026-06-05T10:03:05.000Z'
      );

      INSERT INTO workspace_changed_files (
        changed_file_id,
        change_set_id,
        workspace_checkpoint_id,
        session_id,
        run_id,
        step_id,
        tool_call_id,
        tool_execution_id,
        source_entry_id,
        response_message_id,
        project_path,
        change_kind,
        restore_state,
        before_exists,
        before_content_ref_id,
        before_hash,
        before_byte_length,
        after_exists,
        after_content_ref_id,
        after_hash,
        after_byte_length,
        created_at,
        updated_at
      ) VALUES (
        'changed-file-workspace',
        'change-set-workspace',
        'workspace-checkpoint',
        'session-workspace',
        'run-workspace',
        'step-workspace',
        'tool-call-workspace',
        'tool-execution-workspace',
        'source-workspace',
        'message-workspace',
        'src/index.ts',
        'modified',
        'restorable',
        1,
        'snapshot-before',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        6,
        1,
        'snapshot-after',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        5,
        '2026-06-05T10:03:06.000Z',
        '2026-06-05T10:03:06.000Z'
      );

      INSERT INTO workspace_restore_requests (
        restore_request_id,
        change_set_id,
        session_id,
        run_id,
        requested_by,
        status,
        requested_at
      ) VALUES (
        'restore-request-workspace',
        'change-set-workspace',
        'session-workspace',
        'run-workspace',
        'user',
        'completed',
        '2026-06-05T10:04:00.000Z'
      );

      INSERT INTO workspace_restore_results (
        restore_result_id,
        restore_request_id,
        change_set_id,
        session_id,
        run_id,
        status,
        restored_at
      ) VALUES (
        'restore-result-workspace',
        'restore-request-workspace',
        'change-set-workspace',
        'session-workspace',
        'run-workspace',
        'restored',
        '2026-06-05T10:04:01.000Z'
      );

      INSERT INTO workspace_restore_file_results (
        restore_file_result_id,
        restore_result_id,
        changed_file_id,
        project_path,
        status,
        restored_at
      ) VALUES (
        'restore-file-result-workspace',
        'restore-result-workspace',
        'changed-file-workspace',
        'src/index.ts',
        'restored',
        '2026-06-05T10:04:02.000Z'
      );
    `);

    expect(countRows(database, 'workspace_snapshot_contents')).toBe(2);
    expect(countRows(database, 'workspace_change_sets')).toBe(1);
    expect(countRows(database, 'workspace_checkpoints')).toBe(1);
    expect(countRows(database, 'workspace_changed_files')).toBe(1);
    expect(countRows(database, 'workspace_restore_requests')).toBe(1);
    expect(countRows(database, 'workspace_restore_results')).toBe(1);
    expect(countRows(database, 'workspace_restore_file_results')).toBe(1);

    database.prepare("DELETE FROM sessions WHERE session_id = 'session-workspace'").run();

    expect(countRows(database, 'workspace_snapshot_contents')).toBe(0);
    expect(countRows(database, 'workspace_change_sets')).toBe(0);
    expect(countRows(database, 'workspace_checkpoints')).toBe(0);
    expect(countRows(database, 'workspace_changed_files')).toBe(0);
    expect(countRows(database, 'workspace_restore_requests')).toBe(0);
    expect(countRows(database, 'workspace_restore_results')).toBe(0);
    expect(countRows(database, 'workspace_restore_file_results')).toBe(0);
  });

  it('keeps runtime checkpoint tables separate from workspace checkpoint schema', () => {
    const database = createTestDb();
    migrateDatabase(database);

    expect(tableExists(database, 'checkpoints')).toBe(true);
    expect(tableExists(database, 'checkpoint_restore_records')).toBe(true);
    expect(tableExists(database, 'workspace_checkpoints')).toBe(true);
    expect(tableExists(database, 'workspace_restore_requests')).toBe(true);

    const runtimeCheckpointColumnNames = tableColumns(database, 'checkpoints').map((column) => column.name);
    expect(runtimeCheckpointColumnNames).toEqual(expect.arrayContaining([
      'checkpoint_id',
      'side_effect_refs_json',
      'checkpoint_json',
    ]));
    expect(runtimeCheckpointColumnNames).not.toContain('workspace_checkpoint_id');
    expect(runtimeCheckpointColumnNames).not.toContain('before_content_ref_id');

    const runtimeRestoreColumnNames = tableColumns(database, 'checkpoint_restore_records').map((column) => column.name);
    expect(runtimeRestoreColumnNames).toEqual(expect.arrayContaining([
      'restore_record_id',
      'checkpoint_id',
      'resume_request_id',
      'restore_record_json',
    ]));
    expect(runtimeRestoreColumnNames).not.toContain('restore_request_id');
    expect(runtimeRestoreColumnNames).not.toContain('changed_file_id');
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
