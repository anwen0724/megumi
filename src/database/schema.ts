// Defines the initial SQLite schema for session persistence in the new src architecture.
import type { Migration } from './migration';

export const DATABASE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create-session-state',
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        workspace_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result', 'system')),
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS session_source_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES session_source_entries(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('message', 'branch', 'retry', 'rerun', 'run')),
        ref_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS session_active_leaves (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS branch_markers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        from_source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        label TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS retry_attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        target_source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('retry', 'rerun')),
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        created_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS session_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source_entry_id TEXT NOT NULL REFERENCES session_source_entries(id) ON DELETE CASCADE,
        input_summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled')
        ),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error_json TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_session_messages_session_created
        ON session_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_session_source_entries_session_parent
        ON session_source_entries(session_id, parent_id);
      CREATE INDEX IF NOT EXISTS idx_session_runs_session_started
        ON session_runs(session_id, started_at);
    `,
  },
  {
    version: 2,
    name: 'create-desktop-projects',
    up: `
      CREATE TABLE IF NOT EXISTS desktop_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('available', 'missing')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_desktop_projects_last_opened
        ON desktop_projects(last_opened_at);
    `,
  },
  {
    version: 3,
    name: 'create-runtime-events',
    up: `
      CREATE TABLE IF NOT EXISTS runtime_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_id TEXT,
        type TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        occurred_at TEXT NOT NULL,
        payload_json TEXT,
        event_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_events_run_sequence
        ON runtime_events(run_id, sequence);
    `,
  },
  {
    version: 4,
    name: 'create-recovery-requests',
    up: `
      CREATE TABLE IF NOT EXISTS recovery_cancel_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_id TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT,
        request_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recovery_retry_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_id TEXT,
        retry_kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT,
        request_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recovery_resume_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_id TEXT,
        approval_request_id TEXT,
        decision TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT,
        request_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recovery_cancel_requests_run
        ON recovery_cancel_requests(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_recovery_retry_requests_run
        ON recovery_retry_requests(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_recovery_resume_requests_run
        ON recovery_resume_requests(run_id, created_at);
    `,
  },
  {
    version: 5,
    name: 'create-tools-permission-workspace-productization',
    up: `
      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'rejected', 'awaiting_approval')),
        run_id TEXT,
        session_id TEXT,
        workspace_id TEXT,
        turn_index INTEGER,
        started_at TEXT,
        ended_at TEXT,
        workspace_change_set_id TEXT,
        execution_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_audit_records (
        id TEXT PRIMARY KEY,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        session_id TEXT,
        workspace_id TEXT,
        created_at TEXT NOT NULL,
        error_json TEXT,
        decision_json TEXT,
        audit_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_snapshots (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        mode_source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_policy_decisions (
        id TEXT PRIMARY KEY,
        decision_kind TEXT NOT NULL CHECK (decision_kind IN ('allow', 'ask', 'deny')),
        operation TEXT NOT NULL,
        target TEXT,
        command TEXT,
        mode TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decision_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_approval_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        session_id TEXT,
        tool_call_id TEXT NOT NULL,
        tool_execution_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'cancelled', 'expired')),
        policy_decision_id TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        request_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_approval_records (
        id TEXT PRIMARY KEY,
        approval_request_id TEXT NOT NULL,
        run_id TEXT,
        session_id TEXT,
        tool_call_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        resolved_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_records (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        target TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT,
        run_id TEXT,
        source_approval_request_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        record_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        workspace_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_change_sets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        run_id TEXT,
        tool_call_id TEXT,
        tool_execution_id TEXT,
        status TEXT NOT NULL,
        changed_file_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        change_set_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_changed_files (
        id TEXT PRIMARY KEY,
        change_set_id TEXT NOT NULL,
        workspace_id TEXT,
        run_id TEXT,
        tool_call_id TEXT,
        tool_execution_id TEXT,
        path TEXT NOT NULL,
        operation TEXT NOT NULL,
        restore_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        changed_file_json TEXT NOT NULL,
        FOREIGN KEY(change_set_id) REFERENCES workspace_change_sets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workspace_checkpoints (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_id TEXT,
        change_set_id TEXT,
        status TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_restore_requests (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        change_set_id TEXT,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        request_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_restore_results (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        restored_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_executions_run ON tool_executions(run_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_tool_executions_call ON tool_executions(tool_call_id);
      CREATE INDEX IF NOT EXISTS idx_tool_audit_records_call ON tool_audit_records(tool_call_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_permission_approval_requests_run ON permission_approval_requests(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_permission_records_session_target ON permission_records(session_id, operation, target);
      CREATE INDEX IF NOT EXISTS idx_workspace_change_sets_run ON workspace_change_sets(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workspace_changed_files_change_set ON workspace_changed_files(change_set_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_restore_requests_change_set ON workspace_restore_requests(change_set_id);
    `,
  },
  {
    version: 6,
    name: 'add-session-workspace-path',
    up: `
      ALTER TABLE sessions ADD COLUMN workspace_path TEXT;
    `,
  },
];
