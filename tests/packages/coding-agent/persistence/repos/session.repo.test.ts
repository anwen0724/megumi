// Verifies session aggregate persistence on the redesigned session tables.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { SessionRepository } from '@megumi/coding-agent/persistence/repos/session.repo';
import { WorkspaceRepository } from '@megumi/coding-agent/persistence/repos/workspace.repo';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return database;
}

describe('SessionRepository', () => {
  it('creates a session with no active entry before input', () => {
    const database = createTestDatabase();
    const workspaceId = seedWorkspace(database);
    const repo = new SessionRepository(database);

    const created = repo.createSession({
      sessionId: 'session-1',
      workspaceId,
      title: 'Session',
      now: '2026-06-30T00:00:00.000Z',
    });

    expect(created.sessionId).toBe('session-1');
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?').get('session-1')).toEqual({
      active_entry_id: null,
    });
  });

  it('appends a user message and advances the active session entry', () => {
    const database = createTestDatabase();
    const workspaceId = seedWorkspace(database);
    const repo = new SessionRepository(database);
    repo.createSession({
      sessionId: 'session-1',
      workspaceId,
      title: 'Session',
      now: '2026-06-30T00:00:00.000Z',
    });

    const message = repo.appendUserMessage({
      messageId: 'message-user-1',
      sessionId: 'session-1',
      contentText: 'hello',
      createdAt: '2026-06-30T00:00:01.000Z',
    });

    expect(message).toEqual({
      messageId: 'message-user-1',
      entryId: 'message:message-user-1',
    });
    expect(database.prepare('SELECT role, content_text FROM session_messages WHERE message_id = ?').get('message-user-1')).toEqual({
      role: 'user',
      content_text: 'hello',
    });
    expect(database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?').get('session-1')).toEqual({
      active_entry_id: 'message:message-user-1',
    });
    expect(database.prepare('SELECT entry_kind, message_id FROM session_entries WHERE entry_id = ?').get('message:message-user-1')).toEqual({
      entry_kind: 'message',
      message_id: 'message-user-1',
    });
    expect(database.prepare('SELECT previous_entry_id, next_entry_id, reason FROM session_leaf_changes WHERE next_entry_id = ?').get('message:message-user-1')).toEqual({
      previous_entry_id: null,
      next_entry_id: 'message:message-user-1',
      reason: 'user_input_created',
    });
  });
});

function seedWorkspace(database: ReturnType<typeof createTestDatabase>): string {
  return new WorkspaceRepository(database).upsertFromRepoPath({
    repoPath: 'C:/workspaces/project',
    now: '2026-06-30T00:00:00.000Z',
  }).projectId;
}
