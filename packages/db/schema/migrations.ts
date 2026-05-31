import type { MegumiDatabase } from '../connection';

type TableColumnInfo = {
  name: string;
  notnull: 0 | 1;
};

function tableExists(database: MegumiDatabase, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function tableColumns(database: MegumiDatabase, tableName: string): TableColumnInfo[] {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as TableColumnInfo[];
}

function archiveTableIfNeeded(
  database: MegumiDatabase,
  sourceTableName: string,
  legacyTableName: string,
): void {
  if (!tableExists(database, sourceTableName) || tableExists(database, legacyTableName)) {
    return;
  }

  database.exec(`ALTER TABLE ${sourceTableName} RENAME TO ${legacyTableName};`);
}

function addColumnIfMissing(
  database: MegumiDatabase,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (tableColumns(database, tableName).some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

function archiveLegacyToolPersistenceTables(database: MegumiDatabase): void {
  database.exec(`
    DROP INDEX IF EXISTS idx_tool_uses_run_id;
    DROP INDEX IF EXISTS idx_tool_uses_model_step_id;
    DROP INDEX IF EXISTS idx_tool_calls_run_id;
    DROP INDEX IF EXISTS idx_tool_calls_status;
    DROP INDEX IF EXISTS idx_tool_calls_tool_use_id;
    DROP INDEX IF EXISTS idx_tool_results_tool_use_id;
    DROP INDEX IF EXISTS idx_permission_decisions_tool_use_id;
    DROP INDEX IF EXISTS idx_approval_requests_tool_call_id;
    DROP INDEX IF EXISTS idx_tool_observations_tool_call_id;
  `);

  const toolCallColumns = tableExists(database, 'tool_calls')
    ? tableColumns(database, 'tool_calls')
    : [];
  const hasCanonicalToolCalls = toolCallColumns.some((column) => column.name === 'provider_tool_call_id')
    && toolCallColumns.some((column) => column.name === 'model_step_id')
    && !toolCallColumns.some((column) => column.name === 'tool_use_id');

  archiveTableIfNeeded(database, 'tool_uses', 'tool_uses_legacy_08');
  if (!hasCanonicalToolCalls) {
    archiveTableIfNeeded(database, 'tool_calls', 'tool_calls_legacy_08');
  }
  archiveTableIfNeeded(database, 'tool_policy_decisions', 'tool_policy_decisions_legacy_05');
  if (!hasCanonicalToolCalls) {
    archiveTableIfNeeded(database, 'approval_requests', 'approval_requests_legacy_08');
    archiveTableIfNeeded(database, 'approval_records', 'approval_records_legacy_08');
    archiveTableIfNeeded(database, 'tool_observations', 'tool_observations_legacy_08');
    archiveTableIfNeeded(database, 'permission_decisions', 'permission_decisions_legacy_08');
    archiveTableIfNeeded(database, 'tool_results', 'tool_results_legacy_08');
  }
}

export function migrateDatabase(database: MegumiDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS provider_settings (
      id TEXT NOT NULL,
      provider_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      base_url TEXT,
      default_model_id TEXT NOT NULL,
      secret_ref_id TEXT,
      secret_ref_provider_id TEXT,
      secret_ref_scope TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_provider_settings_provider_id
    ON provider_settings(provider_id);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      repo_path_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo_path_key
      ON projects(repo_path_key);

    CREATE INDEX IF NOT EXISTS idx_projects_status
      ON projects(status);

    CREATE INDEX IF NOT EXISTS idx_projects_last_opened_at
      ON projects(last_opened_at DESC);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
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

    CREATE TABLE IF NOT EXISTS session_messages (
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

    CREATE TABLE IF NOT EXISTS session_compactions (
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

    CREATE TABLE IF NOT EXISTS session_source_entries (
      source_entry_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_source_entry_id TEXT,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_uri TEXT,
      source_ref_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      UNIQUE(session_id, source_kind, source_id),
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(parent_source_entry_id) REFERENCES session_source_entries(source_entry_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_active_leaves (
      session_id TEXT PRIMARY KEY,
      leaf_source_entry_id TEXT,
      updated_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(leaf_source_entry_id) REFERENCES session_source_entries(source_entry_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_branch_markers (
      branch_marker_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      previous_leaf_source_entry_id TEXT,
      target_leaf_source_entry_id TEXT,
      selected_source_ref_json TEXT NOT NULL,
      seed_source_ref_json TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      branch_marker_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(previous_leaf_source_entry_id) REFERENCES session_source_entries(source_entry_id) ON DELETE SET NULL,
      FOREIGN KEY(target_leaf_source_entry_id) REFERENCES session_source_entries(source_entry_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_retry_attempts (
      retry_attempt_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      base_run_id TEXT,
      base_source_entry_id TEXT,
      attempt_number INTEGER NOT NULL,
      retry_kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      retryable INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      attempt_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(base_run_id) REFERENCES runs(run_id) ON DELETE SET NULL,
      FOREIGN KEY(base_source_entry_id) REFERENCES session_source_entries(source_entry_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_interrupted_run_markers (
      interrupted_marker_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      marked_at TEXT NOT NULL,
      metadata_json TEXT,
      marker_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
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

    CREATE TABLE IF NOT EXISTS run_steps (
      step_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_step_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      started_at TEXT,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(parent_step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_actions (
      action_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      input_preview_json TEXT,
      error_json TEXT,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_observations (
      observation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      action_id TEXT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      received_at TEXT NOT NULL,
      summary TEXT,
      data_ref TEXT,
      error_json TEXT,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL,
      FOREIGN KEY(action_id) REFERENCES run_actions(action_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT,
      run_id TEXT,
      step_id TEXT,
      action_id TEXT,
      observation_id TEXT,
      message_id TEXT,
      event_type TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      visibility TEXT NOT NULL,
      persist TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      event_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL,
      FOREIGN KEY(action_id) REFERENCES run_actions(action_id) ON DELETE SET NULL,
      FOREIGN KEY(observation_id) REFERENCES run_observations(observation_id) ON DELETE SET NULL,
      FOREIGN KEY(message_id) REFERENCES session_messages(message_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_messages (
      message_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_time TEXT NOT NULL,
      turn_order INTEGER NOT NULL DEFAULT 0,
      blocks_json TEXT NOT NULL,
      message_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_run_commits (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      committed_at TEXT,
      updated_at TEXT NOT NULL,
      error_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS timeline_commit_diagnostics (
      diagnostic_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS trg_session_source_entries_parent_same_session_insert
    BEFORE INSERT ON session_source_entries
    WHEN NEW.parent_source_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM session_source_entries parent
        WHERE parent.source_entry_id = NEW.parent_source_entry_id
          AND parent.session_id = NEW.session_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'session_source_entries.parent_source_entry_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_source_entries_parent_same_session_update
    BEFORE UPDATE OF session_id, parent_source_entry_id ON session_source_entries
    WHEN NEW.parent_source_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM session_source_entries parent
        WHERE parent.source_entry_id = NEW.parent_source_entry_id
          AND parent.session_id = NEW.session_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'session_source_entries.parent_source_entry_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_source_entries_references_same_session_update
    BEFORE UPDATE OF session_id ON session_source_entries
    WHEN NEW.session_id <> OLD.session_id
    BEGIN
      SELECT RAISE(ABORT, 'session_source_entries.session_id cannot move while referenced by a source child')
      WHERE EXISTS (
        SELECT 1
        FROM session_source_entries child
        WHERE child.parent_source_entry_id = OLD.source_entry_id
          AND child.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_source_entries.session_id cannot move while referenced by an active leaf')
      WHERE EXISTS (
        SELECT 1
        FROM session_active_leaves active_leaf
        WHERE active_leaf.leaf_source_entry_id = OLD.source_entry_id
          AND active_leaf.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_source_entries.session_id cannot move while referenced by a branch previous leaf')
      WHERE EXISTS (
        SELECT 1
        FROM session_branch_markers marker
        WHERE marker.previous_leaf_source_entry_id = OLD.source_entry_id
          AND marker.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_source_entries.session_id cannot move while referenced by a branch target leaf')
      WHERE EXISTS (
        SELECT 1
        FROM session_branch_markers marker
        WHERE marker.target_leaf_source_entry_id = OLD.source_entry_id
          AND marker.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_source_entries.session_id cannot move while referenced by a retry base source')
      WHERE EXISTS (
        SELECT 1
        FROM session_retry_attempts attempt
        WHERE attempt.base_source_entry_id = OLD.source_entry_id
          AND attempt.session_id <> NEW.session_id
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_active_leaves_leaf_same_session_insert
    BEFORE INSERT ON session_active_leaves
    WHEN NEW.leaf_source_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM session_source_entries leaf
        WHERE leaf.source_entry_id = NEW.leaf_source_entry_id
          AND leaf.session_id = NEW.session_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'session_active_leaves.leaf_source_entry_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_active_leaves_leaf_same_session_update
    BEFORE UPDATE OF session_id, leaf_source_entry_id ON session_active_leaves
    WHEN NEW.leaf_source_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM session_source_entries leaf
        WHERE leaf.source_entry_id = NEW.leaf_source_entry_id
          AND leaf.session_id = NEW.session_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'session_active_leaves.leaf_source_entry_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_branch_markers_sources_same_session_insert
    BEFORE INSERT ON session_branch_markers
    BEGIN
      SELECT RAISE(ABORT, 'session_branch_markers.previous_leaf_source_entry_id must belong to the same session')
      WHERE NEW.previous_leaf_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries previous_leaf
          WHERE previous_leaf.source_entry_id = NEW.previous_leaf_source_entry_id
            AND previous_leaf.session_id = NEW.session_id
        );

      SELECT RAISE(ABORT, 'session_branch_markers.target_leaf_source_entry_id must belong to the same session')
      WHERE NEW.target_leaf_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries target_leaf
          WHERE target_leaf.source_entry_id = NEW.target_leaf_source_entry_id
            AND target_leaf.session_id = NEW.session_id
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_branch_markers_sources_same_session_update
    BEFORE UPDATE OF session_id, previous_leaf_source_entry_id, target_leaf_source_entry_id ON session_branch_markers
    BEGIN
      SELECT RAISE(ABORT, 'session_branch_markers.previous_leaf_source_entry_id must belong to the same session')
      WHERE NEW.previous_leaf_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries previous_leaf
          WHERE previous_leaf.source_entry_id = NEW.previous_leaf_source_entry_id
            AND previous_leaf.session_id = NEW.session_id
        );

      SELECT RAISE(ABORT, 'session_branch_markers.target_leaf_source_entry_id must belong to the same session')
      WHERE NEW.target_leaf_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries target_leaf
          WHERE target_leaf.source_entry_id = NEW.target_leaf_source_entry_id
            AND target_leaf.session_id = NEW.session_id
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_retry_attempts_refs_same_session_insert
    BEFORE INSERT ON session_retry_attempts
    BEGIN
      SELECT RAISE(ABORT, 'session_retry_attempts.run_id must belong to the same session')
      WHERE NOT EXISTS (
        SELECT 1
        FROM runs run
        WHERE run.run_id = NEW.run_id
          AND run.session_id = NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_retry_attempts.base_run_id must belong to the same session')
      WHERE NEW.base_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM runs base_run
          WHERE base_run.run_id = NEW.base_run_id
            AND base_run.session_id = NEW.session_id
        );

      SELECT RAISE(ABORT, 'session_retry_attempts.base_source_entry_id must belong to the same session')
      WHERE NEW.base_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries base_source
          WHERE base_source.source_entry_id = NEW.base_source_entry_id
            AND base_source.session_id = NEW.session_id
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_retry_attempts_refs_same_session_update
    BEFORE UPDATE OF session_id, run_id, base_run_id, base_source_entry_id ON session_retry_attempts
    BEGIN
      SELECT RAISE(ABORT, 'session_retry_attempts.run_id must belong to the same session')
      WHERE NOT EXISTS (
        SELECT 1
        FROM runs run
        WHERE run.run_id = NEW.run_id
          AND run.session_id = NEW.session_id
      );

      SELECT RAISE(ABORT, 'session_retry_attempts.base_run_id must belong to the same session')
      WHERE NEW.base_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM runs base_run
          WHERE base_run.run_id = NEW.base_run_id
            AND base_run.session_id = NEW.session_id
        );

      SELECT RAISE(ABORT, 'session_retry_attempts.base_source_entry_id must belong to the same session')
      WHERE NEW.base_source_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM session_source_entries base_source
          WHERE base_source.source_entry_id = NEW.base_source_entry_id
            AND base_source.session_id = NEW.session_id
        );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_interrupted_run_markers_run_same_session_insert
    BEFORE INSERT ON session_interrupted_run_markers
    WHEN NOT EXISTS (
      SELECT 1
      FROM runs run
      WHERE run.run_id = NEW.run_id
        AND run.session_id = NEW.session_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'session_interrupted_run_markers.run_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_session_interrupted_run_markers_run_same_session_update
    BEFORE UPDATE OF session_id, run_id ON session_interrupted_run_markers
    WHEN NOT EXISTS (
      SELECT 1
      FROM runs run
      WHERE run.run_id = NEW.run_id
        AND run.session_id = NEW.session_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'session_interrupted_run_markers.run_id must belong to the same session');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_runs_active_path_references_same_session_update
    BEFORE UPDATE OF session_id ON runs
    WHEN NEW.session_id <> OLD.session_id
    BEGIN
      SELECT RAISE(ABORT, 'runs.session_id cannot move while referenced by a retry attempt run')
      WHERE EXISTS (
        SELECT 1
        FROM session_retry_attempts attempt
        WHERE attempt.run_id = OLD.run_id
          AND attempt.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'runs.session_id cannot move while referenced by a retry attempt base run')
      WHERE EXISTS (
        SELECT 1
        FROM session_retry_attempts attempt
        WHERE attempt.base_run_id = OLD.run_id
          AND attempt.session_id <> NEW.session_id
      );

      SELECT RAISE(ABORT, 'runs.session_id cannot move while referenced by an interrupted run marker')
      WHERE EXISTS (
        SELECT 1
        FROM session_interrupted_run_markers marker
        WHERE marker.run_id = OLD.run_id
          AND marker.session_id <> NEW.session_id
      );
    END;
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS run_context_baselines (
      context_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      baseline_context_id TEXT,
      context_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_context_source_refs (
      source_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      workspace_id TEXT,
      workspace_path TEXT,
      relative_path TEXT,
      content_hash TEXT,
      mtime TEXT,
      range_json TEXT,
      loaded_at TEXT NOT NULL,
      freshness TEXT NOT NULL,
      redaction_state TEXT NOT NULL,
      selection_reason TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_context_patches (
      patch_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      requested_by TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_ref TEXT,
      source_ref TEXT,
      reason TEXT NOT NULL,
      priority INTEGER,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      status TEXT NOT NULL,
      rejection_reason TEXT,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_context_builds (
      build_id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT,
      source_ids_json TEXT NOT NULL,
      selection_record_ids_json TEXT NOT NULL,
      redaction_record_ids_json TEXT NOT NULL,
      truncation_record_ids_json TEXT NOT NULL,
      built_at TEXT NOT NULL,
      snapshot_policy TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(context_id) REFERENCES run_context_baselines(context_id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS run_mode_snapshots (
      mode_snapshot_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      mode_label TEXT NOT NULL,
      mode_json TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      selection_source TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS implementation_plan_artifacts (
      plan_artifact_id TEXT PRIMARY KEY,
      producing_run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      rejected_at TEXT,
      superseded_at TEXT,
      superseded_by_plan_id TEXT,
      metadata_json TEXT,
      FOREIGN KEY(producing_run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(superseded_by_plan_id) REFERENCES implementation_plan_artifacts(plan_artifact_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_source_plans (
      run_id TEXT PRIMARY KEY,
      source_plan_id TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(source_plan_id) REFERENCES implementation_plan_artifacts(plan_artifact_id) ON DELETE RESTRICT
    );
  `);

  archiveLegacyToolPersistenceTables(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS model_steps (
      model_step_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      model_step_json TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      tool_call_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      model_step_id TEXT NOT NULL,
      provider_tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      input_preview_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      tool_call_json TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(model_step_id) REFERENCES model_steps(model_step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      tool_execution_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action_id TEXT,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      input_preview_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      side_effect TEXT NOT NULL,
      result_preview TEXT,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_json TEXT,
      metadata_json TEXT,
      tool_execution_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE,
      FOREIGN KEY(action_id) REFERENCES run_actions(action_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tool_results (
      tool_result_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      tool_execution_id TEXT,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text_content TEXT,
      structured_content_json TEXT,
      content_refs_json TEXT,
      redaction_state TEXT NOT NULL,
      error_json TEXT,
      denial_reason TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      result_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(tool_execution_id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS permission_decisions (
      permission_decision_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      tool_execution_id TEXT,
      run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      source TEXT NOT NULL,
      mode TEXT NOT NULL,
      reason TEXT NOT NULL,
      classifier_label TEXT,
      capability TEXT NOT NULL,
      side_effect TEXT NOT NULL,
      matched_rule_json TEXT,
      target TEXT,
      effective_risk_level TEXT NOT NULL,
      required_approval_json TEXT,
      required_sandbox_json TEXT,
      evaluated_at TEXT NOT NULL,
      metadata_json TEXT,
      decision_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(tool_execution_id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      approval_request_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      tool_execution_id TEXT NOT NULL,
      permission_decision_id TEXT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_scope TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      resolved_at TEXT,
      request_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(tool_execution_id) ON DELETE CASCADE,
      FOREIGN KEY(permission_decision_id) REFERENCES permission_decisions(permission_decision_id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      approval_record_id TEXT PRIMARY KEY,
      approval_request_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_execution_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      scope TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      record_json TEXT NOT NULL,
      FOREIGN KEY(approval_request_id) REFERENCES approval_requests(approval_request_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(tool_execution_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_observations (
      observation_id TEXT PRIMARY KEY,
      tool_execution_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      text_preview TEXT,
      content_refs_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      observation_json TEXT NOT NULL,
      FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(tool_execution_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      action_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      boundary TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      mode_snapshot_ref TEXT,
      context_build_ref TEXT,
      policy_snapshot_ref TEXT,
      tool_registry_snapshot_ref TEXT,
      approval_request_id TEXT,
      tool_call_id TEXT,
      parent_checkpoint_id TEXT,
      side_effect_refs_json TEXT NOT NULL,
      resume_cursor TEXT,
      state_summary TEXT NOT NULL,
      state_ref TEXT,
      metadata_json TEXT,
      checkpoint_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_run_sequence
      ON checkpoints(run_id, sequence);

    CREATE INDEX IF NOT EXISTS idx_checkpoints_run_status
      ON checkpoints(run_id, status);

    CREATE INDEX IF NOT EXISTS idx_checkpoints_approval_request
      ON checkpoints(approval_request_id);

    CREATE TABLE IF NOT EXISTS resume_requests (
      resume_request_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      checkpoint_id TEXT,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      resume_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      request_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resume_requests_run_created
      ON resume_requests(run_id, created_at);

    CREATE TABLE IF NOT EXISTS cancel_requests (
      cancel_request_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      action_id TEXT,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      request_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cancel_requests_run_created
      ON cancel_requests(run_id, created_at);

    CREATE TABLE IF NOT EXISTS retry_requests (
      retry_request_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      action_id TEXT,
      checkpoint_id TEXT,
      requested_by TEXT NOT NULL,
      retry_kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      request_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_retry_requests_run_created
      ON retry_requests(run_id, created_at);

    CREATE TABLE IF NOT EXISTS checkpoint_restore_records (
      restore_record_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      resume_request_id TEXT,
      status TEXT NOT NULL,
      restored_at TEXT NOT NULL,
      error_json TEXT,
      metadata_json TEXT,
      restore_record_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoint_restore_records_run_restored
      ON checkpoint_restore_records(run_id, restored_at);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY,
      session_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      producing_run_id TEXT NOT NULL,
      producing_step_id TEXT,
      current_version_id TEXT,
      pinned_version_ids_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      metadata_json TEXT,
      artifact_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE SET NULL,
      FOREIGN KEY(producing_run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(producing_step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_version_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_format TEXT NOT NULL,
      storage TEXT NOT NULL,
      content_key TEXT,
      inline_text TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      text_preview TEXT NOT NULL,
      redaction_state TEXT NOT NULL,
      change_summary TEXT,
      created_by_run_id TEXT NOT NULL,
      created_by_step_id TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      version_json TEXT NOT NULL,
      UNIQUE(artifact_id, version_number),
      FOREIGN KEY(artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by_run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(created_by_step_id) REFERENCES run_steps(step_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_source_refs (
      source_ref_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      artifact_version_id TEXT,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      label TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      source_ref_json TEXT NOT NULL,
      FOREIGN KEY(artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
      FOREIGN KEY(artifact_version_id) REFERENCES artifact_versions(artifact_version_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_relations (
      relation_id TEXT PRIMARY KEY,
      from_artifact_id TEXT NOT NULL,
      from_version_id TEXT,
      to_artifact_id TEXT NOT NULL,
      to_version_id TEXT,
      kind TEXT NOT NULL,
      created_by_run_id TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      relation_json TEXT NOT NULL,
      FOREIGN KEY(from_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
      FOREIGN KEY(from_version_id) REFERENCES artifact_versions(artifact_version_id) ON DELETE SET NULL,
      FOREIGN KEY(to_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
      FOREIGN KEY(to_version_id) REFERENCES artifact_versions(artifact_version_id) ON DELETE SET NULL,
      FOREIGN KEY(created_by_run_id) REFERENCES runs(run_id) ON DELETE SET NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_candidates (
      candidate_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      project_id TEXT,
      session_id TEXT,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      confidence REAL NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      rejection_reason TEXT,
      metadata_json TEXT,
      candidate_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_records (
      memory_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      project_id TEXT,
      session_id TEXT,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_from_candidate_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER,
      deleted_at TEXT,
      disabled_at TEXT,
      metadata_json TEXT,
      memory_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_source_refs (
      source_ref_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      label TEXT,
      excerpt_preview TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      source_ref_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_recall_requests (
      recall_request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT,
      workspace_id TEXT,
      project_id TEXT,
      query TEXT,
      scopes_json TEXT NOT NULL,
      kinds_json TEXT,
      limit_count INTEGER NOT NULL,
      budget INTEGER,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      request_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_recall_results (
      recall_result_id TEXT PRIMARY KEY,
      recall_request_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      relevance_score REAL NOT NULL,
      confidence REAL NOT NULL,
      selected_for_context INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      result_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_access_logs (
      access_log_id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      session_id TEXT,
      run_id TEXT,
      recall_request_id TEXT,
      access_kind TEXT NOT NULL,
      accessed_at TEXT NOT NULL,
      selected_for_context INTEGER NOT NULL,
      metadata_json TEXT,
      access_log_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_audit_logs (
      audit_log_id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT,
      audit_log_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_settings (
      workspace_id TEXT PRIMARY KEY,
      auto_capture_enabled INTEGER NOT NULL,
      default_candidate_review_mode TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT,
      settings_json TEXT NOT NULL
    );
  `);

  addColumnIfMissing(database, 'timeline_messages', 'turn_order', 'INTEGER');

  database.exec(`
    UPDATE timeline_messages
    SET turn_order = CASE role WHEN 'assistant' THEN 1 ELSE 0 END
    WHERE turn_order IS NULL;
  `);

  database.exec(`
    DROP INDEX IF EXISTS idx_timeline_messages_session_order;
  `);


  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
    ON session_messages(session_id);

    CREATE INDEX IF NOT EXISTS idx_session_compactions_session_created
    ON session_compactions(session_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_session_compactions_session_status_created
    ON session_compactions(session_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_session_source_entries_session_parent
    ON session_source_entries(session_id, parent_source_entry_id);

    CREATE INDEX IF NOT EXISTS idx_session_source_entries_session_ref
    ON session_source_entries(session_id, source_kind, source_id);

    CREATE INDEX IF NOT EXISTS idx_session_source_entries_parent
    ON session_source_entries(parent_source_entry_id);

    CREATE INDEX IF NOT EXISTS idx_session_active_leaves_leaf
    ON session_active_leaves(leaf_source_entry_id);

    CREATE INDEX IF NOT EXISTS idx_session_branch_markers_session_created
    ON session_branch_markers(session_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_session_retry_attempts_run_attempt
    ON session_retry_attempts(run_id, attempt_number);

    CREATE INDEX IF NOT EXISTS idx_session_retry_attempts_session_created
    ON session_retry_attempts(session_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_session_interrupted_run_markers_run
    ON session_interrupted_run_markers(run_id, marked_at);

    CREATE INDEX IF NOT EXISTS idx_session_interrupted_run_markers_session
    ON session_interrupted_run_markers(session_id, marked_at);

    CREATE INDEX IF NOT EXISTS idx_runs_session_id
    ON runs(session_id);

    CREATE INDEX IF NOT EXISTS idx_run_steps_run_id
    ON run_steps(run_id);

    CREATE INDEX IF NOT EXISTS idx_run_actions_step_id
    ON run_actions(step_id);

    CREATE INDEX IF NOT EXISTS idx_run_observations_run_id
    ON run_observations(run_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_events_run_sequence
    ON runtime_events(run_id, sequence)
    WHERE run_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_timeline_messages_session_order
    ON timeline_messages(project_id, session_id, sort_time, run_id, turn_order, message_id);

    CREATE INDEX IF NOT EXISTS idx_timeline_messages_run_id
    ON timeline_messages(run_id);

    CREATE INDEX IF NOT EXISTS idx_timeline_commit_diagnostics_run_id
    ON timeline_commit_diagnostics(run_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_run_context_baselines_run_id
    ON run_context_baselines(run_id);

    CREATE INDEX IF NOT EXISTS idx_run_context_source_refs_run_id
    ON run_context_source_refs(run_id);

    CREATE INDEX IF NOT EXISTS idx_run_context_patches_run_id
    ON run_context_patches(run_id);

    CREATE INDEX IF NOT EXISTS idx_run_context_builds_run_id
    ON run_context_builds(run_id);

    CREATE INDEX IF NOT EXISTS idx_run_mode_snapshots_run_id
    ON run_mode_snapshots(run_id);

    CREATE INDEX IF NOT EXISTS idx_implementation_plan_artifacts_producing_run_id
    ON implementation_plan_artifacts(producing_run_id);

    CREATE INDEX IF NOT EXISTS idx_run_source_plans_source_plan_id
    ON run_source_plans(source_plan_id);

    CREATE INDEX IF NOT EXISTS idx_model_steps_run_id
    ON model_steps(run_id);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id
    ON tool_calls(run_id);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_model_step_id
    ON tool_calls(model_step_id);

    CREATE INDEX IF NOT EXISTS idx_tool_executions_run_id
    ON tool_executions(run_id);

    CREATE INDEX IF NOT EXISTS idx_tool_executions_status
    ON tool_executions(status);

    CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_call_id
    ON tool_executions(tool_call_id);

    CREATE INDEX IF NOT EXISTS idx_tool_results_tool_call_id
    ON tool_results(tool_call_id);

    CREATE INDEX IF NOT EXISTS idx_permission_decisions_tool_call_id
    ON permission_decisions(tool_call_id);

    CREATE INDEX IF NOT EXISTS idx_approval_requests_tool_execution_id
    ON approval_requests(tool_execution_id);

    CREATE INDEX IF NOT EXISTS idx_tool_observations_tool_execution_id
    ON tool_observations(tool_execution_id);

    CREATE INDEX IF NOT EXISTS idx_artifacts_session_id
    ON artifacts(session_id);

    CREATE INDEX IF NOT EXISTS idx_artifacts_producing_run_id
    ON artifacts(producing_run_id);

    CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id
    ON artifact_versions(artifact_id);

    CREATE INDEX IF NOT EXISTS idx_artifact_source_refs_artifact_id
    ON artifact_source_refs(artifact_id);

    CREATE INDEX IF NOT EXISTS idx_artifact_relations_from_artifact_id
    ON artifact_relations(from_artifact_id);

    CREATE INDEX IF NOT EXISTS idx_artifact_relations_to_artifact_id
    ON artifact_relations(to_artifact_id);

    CREATE INDEX IF NOT EXISTS idx_memory_candidates_workspace_status
    ON memory_candidates(workspace_id, status);

    CREATE INDEX IF NOT EXISTS idx_memory_candidates_session_status
    ON memory_candidates(session_id, status);

    CREATE INDEX IF NOT EXISTS idx_memory_records_scope_status
    ON memory_records(scope, status);

    CREATE INDEX IF NOT EXISTS idx_memory_records_workspace_status
    ON memory_records(workspace_id, status);

    CREATE INDEX IF NOT EXISTS idx_memory_source_refs_owner
    ON memory_source_refs(owner_id, owner_kind);

    CREATE INDEX IF NOT EXISTS idx_memory_recall_results_request_id
    ON memory_recall_results(recall_request_id);

    CREATE INDEX IF NOT EXISTS idx_memory_access_logs_memory_id
    ON memory_access_logs(memory_id);

    CREATE INDEX IF NOT EXISTS idx_memory_audit_logs_target
    ON memory_audit_logs(target_kind, target_id);
  `);
}
