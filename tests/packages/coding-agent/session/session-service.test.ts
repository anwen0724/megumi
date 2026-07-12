import { describe, expect, it } from 'vitest';
import {
  createSessionService,
} from '@megumi/coding-agent/session';
import { SessionRepository } from '@megumi/coding-agent/session/repositories/session-repository';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { WorkspaceRepository } from '@megumi/coding-agent/workspace/repositories/workspace-repository';

function seedWorkspace(database: ReturnType<typeof createDatabase>): string {
  const workspace = new WorkspaceRepository(database).insertOrUpdateWorkspace({
    workspace_id: 'workspace:session-test',
    name: 'session-test',
    root_path: 'C:/workspaces/session-test',
    root_path_key: 'c:/workspaces/session-test',
    status: 'available',
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_opened_at: '2026-07-04T00:00:00.000Z',
  });
  return workspace.workspace_id;
}

function createService() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  const workspaceId = seedWorkspace(database);
  const repository = new SessionRepository(database);
  return {
    database,
    repository,
    workspaceId,
    service: createSessionService({
      repository,
      ids: {
        sessionId: () => 'S1',
        entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
      },
      now: () => '2026-07-04T00:00:00.000Z',
    }),
  };
}

describe('SessionService', () => {
  it('creates, reads, lists, and archives a session', async () => {
    const { service, workspaceId } = createService();

    expect(service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    })).toMatchObject({
      status: 'created',
      session: {
        session_id: 'S1',
        workspace_id: workspaceId,
        active_entry_id: undefined,
      },
    });

    expect(service.getSession({ session_id: 'S1' })).toMatchObject({ status: 'found' });
    expect(service.listSessions({ workspace_id: workspaceId })).toMatchObject({ status: 'ok', sessions: [{ session_id: 'S1' }] });
    expect(service.archiveSession({
      session_id: 'S1',
      archived_at: '2026-07-04T01:00:00.000Z',
    })).toMatchObject({ status: 'archived', session: { status: 'archived' } });
  });

  it('creates sessions with owner-owned id, time, and default title', () => {
    const database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    const workspaceId = seedWorkspace(database);
    const repository = new SessionRepository(database);
    const service = createSessionService({
      repository,
      ids: {
        sessionId: () => 'session:owner-1',
        entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
      },
      now: () => '2026-07-10T00:00:00.000Z',
    });

    const result = service.createSession({ workspace_id: workspaceId });

    expect(result).toEqual({
      status: 'created',
      session: expect.objectContaining({
        session_id: 'session:owner-1',
        workspace_id: workspaceId,
        title: 'New session',
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
      }),
    });
  });

  it('saves user message with attachments and moves active entry', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    });

    const result = await service.saveUserMessage({
      message_id: 'M1',
      session_id: 'S1',
      content_text: '看图',
      attachments: [{
        attachment_id: 'A1',
        type: 'image',
        name: 'error.png',
        mime_type: 'image/png',
        source: { type: 'local_file', path: 'C:/tmp/error.png' },
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'saved',
      message: {
        message: { message_id: 'M1', role: 'user' },
        attachments: [{
          attachment_id: 'A1',
          message_id: 'M1',
          session_id: 'S1',
          source_type: 'local_file',
          source_value: 'C:/tmp/error.png',
        }],
      },
      entry: { session_id: 'S1', entry_type: 'message', message_id: 'M1' },
    });
    expect(service.getActivePath({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      entries: [{ message_id: 'M1' }],
    });
  });

  it('saves assistant message without attachments and moves active entry', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    });
    await service.saveUserMessage({
      message_id: 'M1',
      session_id: 'S1',
      content_text: 'hello',
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(service.saveAssistantMessage({
      message_id: 'M2',
      session_id: 'S1',
      run_id: 'R1',
      content_text: 'reply',
      completed_at: '2026-07-04T00:02:00.000Z',
    })).toMatchObject({
      status: 'saved',
      message: { role: 'assistant', content_text: 'reply' },
      entry: { message_id: 'M2' },
    });
  });

  it('lists all messages or active path messages only', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content_text: 'm1', created_at: '2026-07-04T00:01:00.000Z' });
    await service.saveAssistantMessage({ message_id: 'M2', session_id: 'S1', run_id: 'R1', content_text: 'm2', completed_at: '2026-07-04T00:02:00.000Z' });
    await service.switchActiveEntry({ session_id: 'S1', active_entry_id: m1.status === 'saved' ? m1.entry.entry_id : undefined, updated_at: '2026-07-04T00:03:00.000Z' });
    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content_text: 'm3', created_at: '2026-07-04T00:04:00.000Z' });

    expect(service.listMessages({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      messages: [
        { message: { message_id: 'M1' } },
        { message: { message_id: 'M2' } },
        { message: { message_id: 'M3' } },
      ],
    });
    expect(service.listMessages({ session_id: 'S1', active_path_only: true })).toMatchObject({
      status: 'ok',
      messages: [
        { message: { message_id: 'M1' } },
        { message: { message_id: 'M3' } },
      ],
    });
  });

  it('returns active history with compaction summaries and messages', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content_text: 'm1', created_at: '2026-07-04T00:01:00.000Z' });
    const firstEntryId = m1.status === 'saved' ? m1.entry.entry_id : 'missing';
    await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', content_text: 'm2', created_at: '2026-07-04T00:02:00.000Z' });
    await service.saveCompactionSummary({
      compaction_id: 'C1',
      session_id: 'S1',
      summary_text: 'Earlier summary',
      covered_until_entry_id: firstEntryId,
      created_at: '2026-07-04T00:03:00.000Z',
      append_to_active_path: true,
    });

    const result = await service.getActiveHistory({ session_id: 'S1' });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.history.some((item) => item.type === 'compaction')).toBe(true);
    }
  });

  it('rejects a compaction when the active head changed after Context loaded history', async () => {
    const { repository, service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const first = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content_text: 'm1', created_at: '2026-07-04T00:01:00.000Z' });
    const second = await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', content_text: 'm2', created_at: '2026-07-04T00:02:00.000Z' });
    const firstEntryId = first.status === 'saved' ? first.entry.entry_id : 'missing';
    const expectedHead = second.status === 'saved' ? second.entry.entry_id : 'missing';

    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content_text: 'new branch head', created_at: '2026-07-04T00:03:00.000Z' });

    expect(service.saveCompactionSummary({
      compaction_id: 'C-stale',
      session_id: 'S1',
      summary_text: 'must not persist',
      covered_until_entry_id: firstEntryId,
      expected_active_entry_id: expectedHead,
      created_at: '2026-07-04T00:04:00.000Z',
      append_to_active_path: true,
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'active_entry_changed' },
    });
    expect(repository.findCompactionSummaryById('C-stale')).toBeUndefined();
  });

  it('returns empty active path for a new session', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    });

    expect(service.getActivePath({ session_id: 'S1' })).toEqual({
      status: 'ok',
      entries: [],
    });
  });

  it('fails active path reads for missing sessions instead of returning empty history', () => {
    const { service } = createService();

    expect(service.getActivePath({ session_id: 'missing' })).toMatchObject({
      status: 'failed',
      failure: { code: 'session_not_found' },
    });
    expect(service.listMessages({ session_id: 'missing', active_path_only: true })).toMatchObject({
      status: 'failed',
      failure: { code: 'session_not_found' },
    });
    expect(service.getActiveHistory({ session_id: 'missing' })).toMatchObject({
      status: 'failed',
      failure: { code: 'session_not_found' },
    });
  });

  it('fails when appending an invalid message entry shape through service', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    });

    expect(service.appendSessionEntry({
      entry_id: 'E1',
      session_id: 'S1',
      entry_type: 'message',
      message_id: 'M1',
      compaction_id: 'C1',
      created_at: '2026-07-04T00:00:00.000Z',
    })).toEqual({
      status: 'failed',
      failure: {
        code: 'invalid_session_entry',
        message: 'message entry must have message_id and must not have compaction_id',
      },
    });
  });
});
