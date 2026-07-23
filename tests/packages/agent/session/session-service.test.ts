import { describe, expect, it } from 'vitest';
import {
  createSessionService,
} from '@megumi/agent/session';
import { SessionRepository } from '@megumi/agent/session/repository/session-repository';
import { createDatabase } from '@megumi/agent/persistence/connection';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema/migrate';
import { WorkspaceRepository } from '@megumi/agent/workspace/repositories/workspace-repository';

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
  applyAgentDatabaseMigrations(database);
  const workspaceId = seedWorkspace(database);
  const repository = new SessionRepository(database);
  const managedFiles = new Map<string, Uint8Array>();
  let attachmentSequence = 0;
  return {
    database,
    repository,
    workspaceId,
    service: createSessionService({
      repository,
      ids: {
        sessionId: () => 'S1',
        entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
        attachmentId: () => `A${++attachmentSequence}`,
      },
      now: () => '2026-07-04T00:00:00.000Z',
      attachmentFileStore: {
        async write(input) {
          const referenceId = `${input.attachmentId}/original.png`;
          managedFiles.set(referenceId, input.bytes);
          return { referenceId };
        },
        async read(referenceId) {
          const bytes = managedFiles.get(referenceId);
          if (!bytes) throw new Error('missing');
          return bytes;
        },
        async delete(referenceId) { managedFiles.delete(referenceId); },
      },
    }),
    managedFiles,
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
    applyAgentDatabaseMigrations(database);
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
      content: [{ type: 'text', text: '看图' }],
      attachments: [{
        type: 'image',
        name: 'error.png',
        media_type: 'image/png',
        byte_length: 8,
        bytes: new Uint8Array(8),
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'saved',
      message: {
        message: {
          message_id: 'M1',
          message_kind: 'user_message', content: [{ type: 'text', text: '看图' }],
        },
        attachments: [{
          attachment_id: 'A1',
          message_id: 'M1',
          session_id: 'S1',
          source_type: 'host_reference',
          source_value: 'A1/original.png',
        }],
      },
      entry: { session_id: 'S1', entry_type: 'message', message_id: 'M1' },
    });
    expect(service.getActivePath({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      entries: [{ message_id: 'M1' }],
    });
  });

  it('persists a document as its original local-file reference without creating a managed copy', async () => {
    const { service, workspaceId, managedFiles } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });

    const result = await service.saveUserMessage({
      message_id: 'M-document',
      session_id: 'S1',
      content: [{ type: 'text', text: '总结文档' }],
      attachments: [{
        type: 'file',
        name: 'notes.docx',
        media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        local_path: 'C:/materials/notes.docx',
        size_bytes: 2048,
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'saved',
      message: {
        attachments: [{
          type: 'file',
          source_type: 'local_file',
          source_value: 'C:/materials/notes.docx',
        }],
      },
    });
    expect(managedFiles.size).toBe(0);
    expect(service.listMessages({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      messages: [{
        attachments: [{
          type: 'file',
          source_type: 'local_file',
          source_value: 'C:/materials/notes.docx',
        }],
      }],
    });
  });

  it('saves Assistant Reply without attachments and moves active entry', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({
      workspace_id: workspaceId,
      title: 'Session',
    });
    await service.saveUserMessage({
      message_id: 'M1',
      session_id: 'S1',
      content: [{ type: 'text', text: 'hello' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(service.saveAssistantReply({
      message_id: 'M2',
      session_id: 'S1',
      run_id: 'R1',
      status: 'completed',
      reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'reply' }],
      completed_at: '2026-07-04T00:02:00.000Z',
    })).toMatchObject({
      status: 'saved',
      message: { message_kind: 'assistant_reply', status: 'completed', content: [{ type: 'text', text: 'reply' }] },
      entry: { message_id: 'M2' },
    });
  });

  it('allows only one Assistant Reply per Run', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'M1', session_id: 'S1', run_id: 'R1',
      content: [{ type: 'text', text: 'hello' }], created_at: '2026-07-04T00:01:00.000Z',
    });
    expect(service.saveAssistantReply({
      message_id: 'A1', session_id: 'S1', run_id: 'R1', status: 'completed',
      reason_code: 'normal_completion', content: [{ type: 'text', text: 'first' }],
      completed_at: '2026-07-04T00:02:00.000Z',
    }).status).toBe('saved');

    expect(service.saveAssistantReply({
      message_id: 'A2', session_id: 'S1', run_id: 'R1', status: 'failed',
      reason_code: 'internal_error', content: [],
      completed_at: '2026-07-04T00:03:00.000Z',
    })).toMatchObject({
      status: 'failed', failure: { code: 'assistant_reply_exists' },
    });
  });

  it('derives the initial title from normalized user text', () => {
    const { service, workspaceId } = createService();

    const result = service.createSession({
      workspace_id: workspaceId,
      initial_user_text: '  帮我\n\t分析这个项目目前的架构边界是否合理，并给出具体建议  ',
    });

    expect(result).toMatchObject({
      status: 'created',
      session: {
        title: '帮我 分析这个项目目前的架构边界是否合理，并给出...',
      },
    });
  });

  it('prefers an explicit title over the initial user text', () => {
    const { service, workspaceId } = createService();

    const result = service.createSession({
      workspace_id: workspaceId,
      title: '  Architecture review  ',
      initial_user_text: '这段文字不应该成为标题',
    });

    expect(result).toMatchObject({
      status: 'created',
      session: { title: 'Architecture review' },
    });
  });

  it('rejects a response append when another branch changed the active entry', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const first = await service.saveUserMessage({
      message_id: 'M1', session_id: 'S1', content: [{ type: 'text', text: 'first' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') return;
    await service.saveUserMessage({
      message_id: 'M2', session_id: 'S1', content: [{ type: 'text', text: 'new branch head' }],
      created_at: '2026-07-04T00:02:00.000Z',
    });

    expect(service.saveAssistantReply({
      message_id: 'A1', session_id: 'S1', run_id: 'R1',
      parent_entry_id: first.entry.entry_id,
      status: 'completed',
      reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'stale response' }],
      completed_at: '2026-07-04T00:03:00.000Z',
    })).toMatchObject({ status: 'failed', failure: { code: 'active_entry_changed' } });
    expect(service.listMessages({ session_id: 'S1' })).toMatchObject({
      status: 'ok', messages: [{ message: { message_id: 'M1' } }, { message: { message_id: 'M2' } }],
    });
  });

  it('lists all messages or active path messages only', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    await service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: [{ type: 'text', text: 'm2' }], completed_at: '2026-07-04T00:02:00.000Z' });
    await service.switchActiveEntry({ session_id: 'S1', active_entry_id: m1.status === 'saved' ? m1.entry.entry_id : undefined, updated_at: '2026-07-04T00:03:00.000Z' });
    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content: [{ type: 'text', text: 'm3' }], created_at: '2026-07-04T00:04:00.000Z' });

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

  it('reads canonical image bytes through Session and compensates files when persistence fails', async () => {
    const { service, workspaceId, managedFiles } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const saved = await service.saveUserMessage({
      message_id: 'M-image', session_id: 'S1', content: [],
      attachments: [{ type: 'image', name: 'image.png', media_type: 'image/png', byte_length: bytes.byteLength, bytes }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    expect(saved.status).toBe('saved');
    expect(await service.readAttachmentContent({ attachment_id: 'A1' })).toEqual({
      status: 'ok', content: { bytes, media_type: 'image/png' },
    });

    const failed = await service.saveUserMessage({
      message_id: 'M-missing', session_id: 'missing', content: [],
      attachments: [{ type: 'image', name: 'orphan.png', media_type: 'image/png', byte_length: bytes.byteLength, bytes }],
      created_at: '2026-07-04T00:02:00.000Z',
    });
    expect(failed).toMatchObject({ status: 'failed', failure: { code: 'session_not_found' } });
    expect([...managedFiles.keys()]).toEqual(['A1/original.png']);
  });

  it('lists only user messages for requested Run IDs', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'M1', session_id: 'S1', run_id: 'R1',
      content: [{ type: 'text', text: 'first input' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    await service.saveAssistantReply({
      message_id: 'M2', session_id: 'S1', run_id: 'R1',
      status: 'completed', reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'reply' }],
      completed_at: '2026-07-04T00:02:00.000Z',
    });
    await service.saveUserMessage({
      message_id: 'M3', session_id: 'S1', run_id: 'R2',
      content: [{ type: 'text', text: 'second input' }],
      created_at: '2026-07-04T00:03:00.000Z',
    });

    expect(service.listUserMessagesByRunIds({ run_ids: ['R1', 'R2'] })).toMatchObject({
      status: 'ok',
      messages: [
        { message_id: 'M1', run_id: 'R1', message_kind: 'user_message' },
        { message_id: 'M3', run_id: 'R2', message_kind: 'user_message' },
      ],
    });
  });

  it('returns active history with compaction summaries and messages', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    const firstEntryId = m1.status === 'saved' ? m1.entry.entry_id : 'missing';
    await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', content: [{ type: 'text', text: 'm2' }], created_at: '2026-07-04T00:02:00.000Z' });
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
    const first = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    const second = await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', content: [{ type: 'text', text: 'm2' }], created_at: '2026-07-04T00:02:00.000Z' });
    const firstEntryId = first.status === 'saved' ? first.entry.entry_id : 'missing';
    const expectedHead = second.status === 'saved' ? second.entry.entry_id : 'missing';

    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content: [{ type: 'text', text: 'new branch head' }], created_at: '2026-07-04T00:03:00.000Z' });

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
