/*
 * Creates the minimal Database schema used by Workspace Store focused tests.
 */
import { createDatabase } from '@megumi/database';
import { createWorkspaceStore } from '../../../packages/agent/workspace/src/workspace-store';

export function createWorkspaceStoreFixture() {
  const database = createDatabase({ filename: ':memory:' });
  database.prepare({ sql: `
    CREATE TABLE workspaces (
      workspace_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      root_path_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    )
  ` }).run();
  database.prepare({ sql: `
    CREATE TABLE workspace_changes (
      change_set_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
      session_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      status TEXT NOT NULL,
      effect_coverage TEXT NOT NULL,
      changed_file_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      finalized_at TEXT
    )
  ` }).run();
  database.prepare({ sql: `
    CREATE TABLE workspace_changed_files (
      changed_file_id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL REFERENCES workspace_changes(change_set_id),
      workspace_path TEXT NOT NULL,
      change_kind TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      source_workspace_path TEXT,
      destination_workspace_path TEXT,
      path_type TEXT NOT NULL,
      recoverable INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(change_set_id, workspace_path)
    )
  ` }).run();
  return { database, store: createWorkspaceStore({ database }) };
}
