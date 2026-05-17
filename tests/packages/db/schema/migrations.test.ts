// @vitest-environment node
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
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

  it('upgrades existing session run tables with current repository columns', () => {
    const database = createTestDb();
    database.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT,
        title TEXT NOT NULL,
        title_source TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trigger_message_id TEXT,
        retry_of_run_id TEXT,
        status TEXT NOT NULL,
        run_kind TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        error_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE run_steps (
        step_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE runtime_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT,
        run_id TEXT,
        step_id TEXT,
        event_type TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        visibility TEXT NOT NULL,
        persist TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `);

    migrateDatabase(database);
    const repository = new SessionRunRepository(database);
    const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const runColumns = database.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;

    expect(sessionColumns.map((column) => column.name)).toEqual([
      'session_id',
      'title',
      'workspace_id',
      'workspace_path',
      'status',
      'created_at',
      'updated_at',
      'archived_at',
      'summary',
      'metadata_json',
    ]);
    expect(runColumns.map((column) => column.name)).toEqual([
      'run_id',
      'session_id',
      'trigger_message_id',
      'agent_definition_id',
      'agent_config_snapshot_ref',
      'mode',
      'mode_snapshot_ref',
      'goal',
      'status',
      'created_at',
      'started_at',
      'completed_at',
      'cancelled_at',
      'error_json',
      'source_plan_id',
      'policy_snapshot_ref',
      'metadata_json',
    ]);

    const session = repository.saveSession({
      sessionId: 'session-existing-db',
      title: 'Existing DB session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      status: 'active',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-existing-db',
      sessionId: 'session-existing-db',
      runId: 'run-existing-db',
      role: 'user',
      content: 'Hello',
      status: 'completed',
      createdAt: '2026-05-18T00:00:01.000Z',
      completedAt: '2026-05-18T00:00:01.000Z',
      metadata: { source: 'migration-test' },
    });
    const run = repository.saveRun({
      runId: 'run-existing-db',
      sessionId: 'session-existing-db',
      triggerMessageId: 'message-existing-db',
      mode: 'plan',
      modeSnapshotRef: 'mode-snapshot:existing-db',
      goal: 'Hello',
      status: 'running',
      createdAt: '2026-05-18T00:00:02.000Z',
      sourcePlanId: 'plan:existing-db',
      policySnapshotRef: 'policy:existing-db',
    });
    repository.saveStep({
      stepId: 'step-existing-db',
      runId: 'run-existing-db',
      parentStepId: 'step-parent-existing-db',
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: '2026-05-18T00:00:03.000Z',
      metadata: { source: 'migration-test' },
    });
    repository.appendRuntimeEvent({
      eventId: 'event-existing-db',
      schemaVersion: 1,
      eventType: 'run.started',
      sessionId: 'session-existing-db',
      runId: 'run-existing-db',
      stepId: 'step-existing-db',
      actionId: 'action-existing-db',
      observationId: 'observation-existing-db',
      messageId: 'message-existing-db',
      sequence: 1,
      createdAt: '2026-05-18T00:00:04.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'agent',
      },
    });

    expect(session).toMatchObject({
      sessionId: 'session-existing-db',
      workspacePath: 'C:/all/work/study/megumi',
    });
    expect(run).toMatchObject({
      modeSnapshotRef: 'mode-snapshot:existing-db',
      sourcePlanId: 'plan:existing-db',
      policySnapshotRef: 'policy:existing-db',
    });
    expect(repository.listMessagesBySession('session-existing-db')[0]).toMatchObject({
      runId: 'run-existing-db',
      metadata: { source: 'migration-test' },
    });
    expect(repository.listStepsByRun('run-existing-db')[0]).toMatchObject({
      parentStepId: 'step-parent-existing-db',
      title: 'Model response',
      metadata: { source: 'migration-test' },
    });
    expect(repository.listRuntimeEventsByRun('run-existing-db')[0]).toMatchObject({
      actionId: 'action-existing-db',
      observationId: 'observation-existing-db',
      messageId: 'message-existing-db',
    });
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

  it('drops exact legacy session run tables and indexes', () => {
    const database = createTestDb();
    database.exec(`
      CREATE TABLE agent_sessions (id TEXT);
      CREATE TABLE messages (id TEXT);
      CREATE TABLE agent_runs (id TEXT);
      CREATE TABLE agent_steps (id TEXT);
      CREATE TABLE agent_actions (id TEXT);
      CREATE TABLE agent_observations (id TEXT);
      CREATE TABLE agent_context_baselines (id TEXT);
      CREATE TABLE context_source_refs (id TEXT);
      CREATE TABLE context_patches (id TEXT);
      CREATE TABLE effective_context_builds (id TEXT);
      CREATE TABLE agent_run_mode_snapshots (id TEXT);
      CREATE TABLE agent_run_source_plans (id TEXT);
      CREATE TABLE agent_checkpoints (id TEXT);
      CREATE TABLE agent_resume_requests (id TEXT);
      CREATE TABLE agent_cancel_requests (id TEXT);
      CREATE TABLE agent_retry_requests (id TEXT);

      CREATE INDEX idx_agent_actions_step_id ON agent_actions(id);
      CREATE INDEX idx_agent_cancel_requests_run_created ON agent_cancel_requests(id);
      CREATE INDEX idx_agent_checkpoints_approval_request ON agent_checkpoints(id);
      CREATE INDEX idx_agent_checkpoints_run_sequence ON agent_checkpoints(id);
      CREATE INDEX idx_agent_checkpoints_run_status ON agent_checkpoints(id);
      CREATE INDEX idx_agent_context_baselines_run_id ON agent_context_baselines(id);
      CREATE INDEX idx_agent_observations_run_id ON agent_observations(id);
      CREATE INDEX idx_agent_resume_requests_run_created ON agent_resume_requests(id);
      CREATE INDEX idx_agent_retry_requests_run_created ON agent_retry_requests(id);
      CREATE INDEX idx_agent_run_mode_snapshots_run_id ON agent_run_mode_snapshots(id);
      CREATE INDEX idx_agent_run_source_plans_source_plan_id ON agent_run_source_plans(id);
      CREATE INDEX idx_agent_runs_session_id ON agent_runs(id);
      CREATE INDEX idx_agent_steps_run_id ON agent_steps(id);
    `);

    migrateDatabase(database);

    const legacyObjects = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type IN ('table', 'index')
      AND name IN (
        'agent_sessions',
        'messages',
        'agent_runs',
        'agent_steps',
        'agent_actions',
        'agent_observations',
        'agent_context_baselines',
        'context_source_refs',
        'context_patches',
        'effective_context_builds',
        'agent_run_mode_snapshots',
        'agent_run_source_plans',
        'agent_checkpoints',
        'agent_resume_requests',
        'agent_cancel_requests',
        'agent_retry_requests',
        'idx_agent_actions_step_id',
        'idx_agent_cancel_requests_run_created',
        'idx_agent_checkpoints_approval_request',
        'idx_agent_checkpoints_run_sequence',
        'idx_agent_checkpoints_run_status',
        'idx_agent_context_baselines_run_id',
        'idx_agent_observations_run_id',
        'idx_agent_resume_requests_run_created',
        'idx_agent_retry_requests_run_created',
        'idx_agent_run_mode_snapshots_run_id',
        'idx_agent_run_source_plans_source_plan_id',
        'idx_agent_runs_session_id',
        'idx_agent_steps_run_id'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(legacyObjects).toEqual([]);
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
