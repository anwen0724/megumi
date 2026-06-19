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
];
