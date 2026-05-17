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

  database.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
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
      tool_call_json TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE,
      FOREIGN KEY(action_id) REFERENCES run_actions(action_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_policy_decisions (
      policy_decision_id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      effective_risk_level TEXT NOT NULL,
      reason TEXT NOT NULL,
      required_approval_json TEXT,
      required_sandbox_json TEXT,
      evaluated_at TEXT NOT NULL,
      metadata_json TEXT,
      decision_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
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
      request_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      approval_record_id TEXT PRIMARY KEY,
      approval_request_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      scope TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      record_json TEXT NOT NULL,
      FOREIGN KEY(approval_request_id) REFERENCES approval_requests(approval_request_id) ON DELETE CASCADE,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(step_id) REFERENCES run_steps(step_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_observations (
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
      observation_json TEXT NOT NULL,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
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

  ensureCurrentSchemaColumns(database);
  rebuildIncompatibleSessionRunTables(database);
  dropLegacySessionRunTables(database);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
    ON session_messages(session_id);

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

    CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id
    ON tool_calls(run_id);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_status
    ON tool_calls(status);

    CREATE INDEX IF NOT EXISTS idx_approval_requests_tool_call_id
    ON approval_requests(tool_call_id);

    CREATE INDEX IF NOT EXISTS idx_tool_observations_tool_call_id
    ON tool_observations(tool_call_id);

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

function ensureCurrentSchemaColumns(database: MegumiDatabase): void {
  for (const [tableName, columns] of Object.entries(CURRENT_SCHEMA_COLUMNS)) {
    ensureColumns(database, tableName, columns);
  }
}

function ensureColumns(database: MegumiDatabase, tableName: string, columns: Record<string, string>): void {
  const existingColumns = new Set(
    (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );

  if (existingColumns.size === 0) {
    return;
  }

  for (const [columnName, definition] of Object.entries(columns)) {
    if (!existingColumns.has(columnName)) {
      database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
}

const CURRENT_SCHEMA_COLUMNS: Record<string, Record<string, string>> = {
  sessions: {
    title: "TEXT NOT NULL DEFAULT ''",
    workspace_id: 'TEXT',
    workspace_path: 'TEXT',
    status: "TEXT NOT NULL DEFAULT 'active'",
    created_at: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''",
    archived_at: 'TEXT',
    summary: 'TEXT',
    metadata_json: 'TEXT',
  },
  session_messages: {
    session_id: "TEXT NOT NULL DEFAULT ''",
    run_id: 'TEXT',
    role: "TEXT NOT NULL DEFAULT 'user'",
    content: "TEXT NOT NULL DEFAULT ''",
    status: "TEXT NOT NULL DEFAULT 'completed'",
    created_at: "TEXT NOT NULL DEFAULT ''",
    completed_at: 'TEXT',
    metadata_json: 'TEXT',
  },
  runs: {
    session_id: "TEXT NOT NULL DEFAULT ''",
    trigger_message_id: 'TEXT',
    agent_definition_id: 'TEXT',
    agent_config_snapshot_ref: 'TEXT',
    mode: "TEXT NOT NULL DEFAULT 'chat'",
    mode_snapshot_ref: 'TEXT',
    goal: "TEXT NOT NULL DEFAULT ''",
    status: "TEXT NOT NULL DEFAULT 'queued'",
    created_at: "TEXT NOT NULL DEFAULT ''",
    started_at: 'TEXT',
    completed_at: 'TEXT',
    cancelled_at: 'TEXT',
    error_json: 'TEXT',
    source_plan_id: 'TEXT',
    policy_snapshot_ref: 'TEXT',
    metadata_json: 'TEXT',
  },
  run_steps: {
    run_id: "TEXT NOT NULL DEFAULT ''",
    parent_step_id: 'TEXT',
    kind: "TEXT NOT NULL DEFAULT 'model'",
    status: "TEXT NOT NULL DEFAULT 'pending'",
    title: 'TEXT',
    started_at: 'TEXT',
    completed_at: 'TEXT',
    error_json: 'TEXT',
    metadata_json: 'TEXT',
  },
  run_actions: {
    run_id: "TEXT NOT NULL DEFAULT ''",
    step_id: "TEXT NOT NULL DEFAULT ''",
    kind: "TEXT NOT NULL DEFAULT 'emit_message'",
    status: "TEXT NOT NULL DEFAULT 'requested'",
    requested_at: "TEXT NOT NULL DEFAULT ''",
    completed_at: 'TEXT',
    input_preview_json: 'TEXT',
    error_json: 'TEXT',
    metadata_json: 'TEXT',
  },
  run_observations: {
    run_id: "TEXT NOT NULL DEFAULT ''",
    step_id: 'TEXT',
    action_id: 'TEXT',
    source: "TEXT NOT NULL DEFAULT 'runtime'",
    kind: "TEXT NOT NULL DEFAULT ''",
    received_at: "TEXT NOT NULL DEFAULT ''",
    summary: 'TEXT',
    data_ref: 'TEXT',
    error_json: 'TEXT',
    metadata_json: 'TEXT',
  },
  runtime_events: {
    session_id: 'TEXT',
    run_id: 'TEXT',
    step_id: 'TEXT',
    action_id: 'TEXT',
    observation_id: 'TEXT',
    message_id: 'TEXT',
    event_type: "TEXT NOT NULL DEFAULT ''",
    sequence: 'INTEGER NOT NULL DEFAULT 0',
    created_at: "TEXT NOT NULL DEFAULT ''",
    source: "TEXT NOT NULL DEFAULT 'core'",
    visibility: "TEXT NOT NULL DEFAULT 'user'",
    persist: "TEXT NOT NULL DEFAULT 'required'",
    payload_json: "TEXT NOT NULL DEFAULT '{}'",
    event_json: "TEXT NOT NULL DEFAULT '{}'",
  },
};

function dropLegacySessionRunTables(database: MegumiDatabase): void {
  const previousForeignKeys = database.pragma('foreign_keys', { simple: true }) as number;
  database.pragma('foreign_keys = OFF');
  try {
    database.exec(`
    DROP TABLE IF EXISTS agent_actions;
    DROP TABLE IF EXISTS agent_cancel_requests;
    DROP TABLE IF EXISTS agent_checkpoints;
    DROP TABLE IF EXISTS agent_context_baselines;
    DROP TABLE IF EXISTS agent_observations;
    DROP TABLE IF EXISTS agent_resume_requests;
    DROP TABLE IF EXISTS agent_retry_requests;
    DROP TABLE IF EXISTS agent_run_mode_snapshots;
    DROP TABLE IF EXISTS agent_run_source_plans;
    DROP TABLE IF EXISTS agent_runs;
    DROP TABLE IF EXISTS agent_sessions;
    DROP TABLE IF EXISTS agent_steps;
    DROP TABLE IF EXISTS context_patches;
    DROP TABLE IF EXISTS context_source_refs;
    DROP TABLE IF EXISTS effective_context_builds;
    DROP TABLE IF EXISTS messages;

    DROP INDEX IF EXISTS idx_agent_actions_step_id;
    DROP INDEX IF EXISTS idx_agent_cancel_requests_run_created;
    DROP INDEX IF EXISTS idx_agent_checkpoints_approval_request;
    DROP INDEX IF EXISTS idx_agent_checkpoints_run_sequence;
    DROP INDEX IF EXISTS idx_agent_checkpoints_run_status;
    DROP INDEX IF EXISTS idx_agent_context_baselines_run_id;
    DROP INDEX IF EXISTS idx_agent_observations_run_id;
    DROP INDEX IF EXISTS idx_agent_resume_requests_run_created;
    DROP INDEX IF EXISTS idx_agent_retry_requests_run_created;
    DROP INDEX IF EXISTS idx_agent_run_mode_snapshots_run_id;
    DROP INDEX IF EXISTS idx_agent_run_source_plans_source_plan_id;
    DROP INDEX IF EXISTS idx_agent_runs_session_id;
    DROP INDEX IF EXISTS idx_agent_steps_run_id;
    `);
  } finally {
    database.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
}

function rebuildIncompatibleSessionRunTables(database: MegumiDatabase): void {
  const previousForeignKeys = database.pragma('foreign_keys', { simple: true }) as number;
  const rebuild = database.transaction(() => {
    for (const table of CURRENT_SCHEMA_TABLES) {
      rebuildTableIfIncompatible(database, table);
    }
  });

  database.pragma('foreign_keys = OFF');
  try {
    rebuild();
  } finally {
    database.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
}

function rebuildTableIfIncompatible(database: MegumiDatabase, table: CurrentSchemaTable): void {
  const tableInfo = database.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  if (existingColumns.size === 0) {
    return;
  }

  if (Array.from(existingColumns).every((columnName) => table.columns.includes(columnName))) {
    return;
  }

  const tempTableName = `__megumi_migrate_${table.name}`;
  const columnsSql = table.columns.join(', ');
  const selectSql = table.columns
    .map((columnName) => table.copyExpression(columnName, existingColumns))
    .join(', ');

  database.exec(`DROP TABLE IF EXISTS ${tempTableName}`);
  database.exec(table.createSql(tempTableName));
  database.exec(`
    INSERT INTO ${tempTableName} (${columnsSql})
    SELECT ${selectSql}
    FROM ${table.name}
  `);
  database.exec(`DROP TABLE ${table.name}`);
  database.exec(`ALTER TABLE ${tempTableName} RENAME TO ${table.name}`);
}

interface CurrentSchemaTable {
  name: string;
  columns: string[];
  createSql(tableName: string): string;
  copyExpression(columnName: string, existingColumns: Set<string>): string;
}

function copyCurrentColumn(
  columnName: string,
  existingColumns: Set<string>,
  fallbackExpression: string,
): string {
  return existingColumns.has(columnName) ? columnName : fallbackExpression;
}

const CURRENT_SCHEMA_TABLES: CurrentSchemaTable[] = [
  {
    name: 'sessions',
    columns: [
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
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        session_id: "''",
        title: "''",
        workspace_id: 'NULL',
        workspace_path: 'NULL',
        status: "'active'",
        created_at: "''",
        updated_at: "''",
        archived_at: 'NULL',
        summary: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'session_messages',
    columns: [
      'message_id',
      'session_id',
      'run_id',
      'role',
      'content',
      'status',
      'created_at',
      'completed_at',
      'metadata_json',
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        message_id: "''",
        session_id: "''",
        run_id: 'NULL',
        role: "'user'",
        content: "''",
        status: "'completed'",
        created_at: "''",
        completed_at: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'runs',
    columns: [
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
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      if (columnName === 'mode' && existingColumns.has('run_kind')) {
        return "COALESCE(run_kind, mode, 'chat')";
      }

      const fallbackByColumn: Record<string, string> = {
        run_id: "''",
        session_id: "''",
        trigger_message_id: 'NULL',
        agent_definition_id: 'NULL',
        agent_config_snapshot_ref: 'NULL',
        mode: "'chat'",
        mode_snapshot_ref: 'NULL',
        goal: "''",
        status: "'queued'",
        created_at: "''",
        started_at: 'NULL',
        completed_at: 'NULL',
        cancelled_at: 'NULL',
        error_json: 'NULL',
        source_plan_id: 'NULL',
        policy_snapshot_ref: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'run_steps',
    columns: [
      'step_id',
      'run_id',
      'parent_step_id',
      'kind',
      'status',
      'title',
      'started_at',
      'completed_at',
      'error_json',
      'metadata_json',
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        step_id: "''",
        run_id: "''",
        parent_step_id: 'NULL',
        kind: "'model'",
        status: "'pending'",
        title: 'NULL',
        started_at: 'NULL',
        completed_at: 'NULL',
        error_json: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'run_actions',
    columns: [
      'action_id',
      'run_id',
      'step_id',
      'kind',
      'status',
      'requested_at',
      'completed_at',
      'input_preview_json',
      'error_json',
      'metadata_json',
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        action_id: "''",
        run_id: "''",
        step_id: "''",
        kind: "'emit_message'",
        status: "'requested'",
        requested_at: "''",
        completed_at: 'NULL',
        input_preview_json: 'NULL',
        error_json: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'run_observations',
    columns: [
      'observation_id',
      'run_id',
      'step_id',
      'action_id',
      'source',
      'kind',
      'received_at',
      'summary',
      'data_ref',
      'error_json',
      'metadata_json',
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        observation_id: "''",
        run_id: "''",
        step_id: 'NULL',
        action_id: 'NULL',
        source: "'runtime'",
        kind: "''",
        received_at: "''",
        summary: 'NULL',
        data_ref: 'NULL',
        error_json: 'NULL',
        metadata_json: 'NULL',
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
  {
    name: 'runtime_events',
    columns: [
      'event_id',
      'session_id',
      'run_id',
      'step_id',
      'action_id',
      'observation_id',
      'message_id',
      'event_type',
      'sequence',
      'created_at',
      'source',
      'visibility',
      'persist',
      'payload_json',
      'event_json',
    ],
    createSql: (tableName) => `
      CREATE TABLE ${tableName} (
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
      )
    `,
    copyExpression: (columnName, existingColumns) => {
      const fallbackByColumn: Record<string, string> = {
        event_id: "''",
        session_id: 'NULL',
        run_id: 'NULL',
        step_id: 'NULL',
        action_id: 'NULL',
        observation_id: 'NULL',
        message_id: 'NULL',
        event_type: "''",
        sequence: '0',
        created_at: "''",
        source: "'core'",
        visibility: "'user'",
        persist: "'required'",
        payload_json: "'{}'",
        event_json: "'{}'",
      };
      return copyCurrentColumn(columnName, existingColumns, fallbackByColumn[columnName]);
    },
  },
];
