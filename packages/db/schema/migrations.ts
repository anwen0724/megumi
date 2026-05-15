import type { MegumiDatabase } from '../connection';

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
    CREATE TABLE IF NOT EXISTS agent_sessions (
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

    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT,
      FOREIGN KEY(session_id) REFERENCES agent_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
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
      FOREIGN KEY(session_id) REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY(trigger_message_id) REFERENCES messages(message_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agent_steps (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(parent_step_id) REFERENCES agent_steps(step_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES agent_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_observations (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES agent_steps(step_id) ON DELETE SET NULL,
      FOREIGN KEY(action_id) REFERENCES agent_actions(action_id) ON DELETE SET NULL
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
      FOREIGN KEY(session_id) REFERENCES agent_sessions(session_id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES agent_steps(step_id) ON DELETE SET NULL,
      FOREIGN KEY(action_id) REFERENCES agent_actions(action_id) ON DELETE SET NULL,
      FOREIGN KEY(observation_id) REFERENCES agent_observations(observation_id) ON DELETE SET NULL,
      FOREIGN KEY(message_id) REFERENCES messages(message_id) ON DELETE SET NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_context_baselines (
      context_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      baseline_context_id TEXT,
      context_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS context_source_refs (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS context_patches (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS effective_context_builds (
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
      FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(context_id) REFERENCES agent_context_baselines(context_id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id
    ON messages(session_id);

    CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id
    ON agent_runs(session_id);

    CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id
    ON agent_steps(run_id);

    CREATE INDEX IF NOT EXISTS idx_agent_actions_step_id
    ON agent_actions(step_id);

    CREATE INDEX IF NOT EXISTS idx_agent_observations_run_id
    ON agent_observations(run_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_events_run_sequence
    ON runtime_events(run_id, sequence)
    WHERE run_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_agent_context_baselines_run_id
    ON agent_context_baselines(run_id);

    CREATE INDEX IF NOT EXISTS idx_context_source_refs_run_id
    ON context_source_refs(run_id);

    CREATE INDEX IF NOT EXISTS idx_context_patches_run_id
    ON context_patches(run_id);

    CREATE INDEX IF NOT EXISTS idx_effective_context_builds_run_id
    ON effective_context_builds(run_id);
  `);
}
