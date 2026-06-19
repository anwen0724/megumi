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
];
