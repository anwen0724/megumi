/*
 * Verifies terminal Run reconciliation loads only the requested Run while
 * preserving its position on the complete active Session path.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '@megumi/agent/persistence/connection';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema/migrate';
import { createSessionTimelineQuery } from '@megumi/agent/projections/timeline';
import { createSessionService } from '@megumi/agent/session';
import { SessionRepository } from '@megumi/agent/session/repository/session-repository';
import { WorkspaceRepository } from '@megumi/agent/workspace/repositories/workspace-repository';

describe('Session Run Timeline query', () => {
  it('loads one Run and keeps its full active-path order', () => {
    const database = createDatabase(':memory:');
    applyAgentDatabaseMigrations(database);
    new WorkspaceRepository(database).insertOrUpdateWorkspace({
      workspace_id: 'workspace-1',
      name: 'workspace',
      root_path: 'C:/workspace',
      root_path_key: 'c:/workspace',
      status: 'available',
      created_at: '2026-07-12T00:00:00.000Z',
      updated_at: '2026-07-12T00:00:00.000Z',
      last_opened_at: '2026-07-12T00:00:00.000Z',
    });
    const repository = new SessionRepository(database);
    let sessionSequence = 0;
    const service = createSessionService({
      repository,
      ids: {
        sessionId: () => `session-${++sessionSequence}`,
        entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
      },
      now: () => '2026-07-12T00:00:00.000Z',
    });
    service.createSession({ workspace_id: 'workspace-1' });
    service.saveUserMessage({
      message_id: 'U1', session_id: 'session-1', run_id: 'run-1',
      content: [{ type: 'text', text: 'first' }], created_at: '2026-07-12T00:00:01.000Z',
    });
    service.saveAssistantMessage({
      message_id: 'A1', session_id: 'session-1', run_id: 'run-1', parent_entry_id: 'message:U1',
      content: [{ type: 'text', text: 'one' }], completed_at: '2026-07-12T00:00:02.000Z',
    });
    service.saveUserMessage({
      message_id: 'U2', session_id: 'session-1', run_id: 'run-2', parent_entry_id: 'message:A1',
      content: [{ type: 'text', text: 'second' }], created_at: '2026-07-12T00:00:03.000Z',
    });
    service.saveAssistantMessage({
      message_id: 'A2', session_id: 'session-1', run_id: 'run-2', parent_entry_id: 'message:U2',
      content: [{ type: 'text', text: 'two' }], completed_at: '2026-07-12T00:00:04.000Z',
    });

    const listRunMessages = vi.spyOn(repository, 'listMessagesByRunId');
    const listAllPathMessages = vi.spyOn(repository, 'listMessagesByIds');
    const query = createSessionTimelineQuery({ sessionService: service });

    const result = query.listSessionTimeline({
      workspace_id: 'workspace-1', session_id: 'session-1', run_id: 'run-2',
    });

    expect(listRunMessages).toHaveBeenCalledWith('session-1', 'run-2');
    expect(listAllPathMessages).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(2);
    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'user', runId: 'run-2', historyOrder: 2 }),
      expect.objectContaining({ role: 'assistant', runId: 'run-2', historyOrder: 3 }),
    ]);
  });
});
