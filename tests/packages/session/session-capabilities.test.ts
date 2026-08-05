import { describe, expect, it } from 'vitest';
import {
  createSessionAttachmentReader,
  createSessionCatalog,
  createSessionEntryGraph,
  createSessionHistory,
} from '../../../packages/session/src/index';
import { createSessionStore } from '@megumi/session/store';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src/index';

function seedWorkspace(database: DatabaseConnection): string {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:session-test', 'session-test', 'C:/workspaces/session-test',
      'c:/workspaces/session-test', 'available',
      '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z'
    )
  ` }).run();
  return 'workspace:session-test';
}

function createService(options: {
  sessionId?: string;
  now?: string;
} = {}) {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const workspaceId = seedWorkspace(database);
  const repository = createSessionStore({ database });
  const managedFiles = new Map<string, Uint8Array>();
  let attachmentSequence = 0;
  const attachmentContentStore = {
    async write(input: { attachmentId: string; bytes: Uint8Array }) {
      const referenceId = `${input.attachmentId}/original.png`;
      managedFiles.set(referenceId, input.bytes);
      return { referenceId };
    },
    async read(referenceId: string) {
      const bytes = managedFiles.get(referenceId);
      if (!bytes) throw new Error('missing');
      return bytes;
    },
    async delete(referenceId: string) { managedFiles.delete(referenceId); },
  };
  const ids = {
    sessionId: () => options.sessionId ?? 'S1',
    entryId: ({ kind, source_id }: { kind: 'message' | 'compaction'; source_id: string }) => `${kind}:${source_id}`,
    attachmentId: () => `A${++attachmentSequence}`,
  };
  return {
    database,
    repository,
    workspaceId,
    service: {
      ...createSessionCatalog({
        store: repository,
        ids,
        now: () => options.now ?? '2026-07-04T00:00:00.000Z',
      }),
      ...createSessionHistory({
        store: repository,
        ids,
        attachmentContentStore,
      }),
      ...createSessionEntryGraph({ store: repository }),
      ...createSessionAttachmentReader({
        store: repository,
        contentStore: attachmentContentStore,
      }),
    },
    managedFiles,
  };
}

describe('Session capabilities', () => {
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
    const { service, workspaceId } = createService({
      sessionId: 'session:owner-1',
      now: '2026-07-10T00:00:00.000Z',
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
      display_content: [{ type: 'text', text: '看图' }], model_content: [{ type: 'text', text: '看图' }],
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
          message_kind: 'user_message', display_content: [{ type: 'text', text: '看图' }], model_content: [{ type: 'text', text: '看图' }],
        },
        attachments: [{
          attachment_id: 'A1',
          message_id: 'M1',
          session_id: 'S1',
          source_type: 'host_reference',
          source_value: 'A1/original.png',
          ordinal: 0,
        }],
      },
      entry: { session_id: 'S1', entry_type: 'message', message_id: 'M1' },
    });
    expect(service.getActivePath({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      entries: [{ message_id: 'M1' }],
    });
  });

  it('persists the document size_bytes through reopen for stable attachment blocks', async () => {
    const { service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'M-size',
      session_id: 'S1',
      display_content: [{ type: 'text', text: '带附件' }], model_content: [{ type: 'text', text: '带附件' }],
      attachments: [{
        type: 'file',
        name: 'paper.pdf',
        media_type: 'application/pdf',
        local_path: 'C:/materials/paper.pdf',
        size_bytes: 1_256_000,
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    });

    const reopened = service.listMessages({ session_id: 'S1' });
    expect(reopened.status).toBe('ok');
    if (reopened.status !== 'ok') return;
    const attachment = reopened.messages[0]!.attachments[0];
    expect(attachment).toMatchObject({
      type: 'file',
      name: 'paper.pdf',
      mime_type: 'application/pdf',
      source_type: 'local_file',
      source_value: 'C:/materials/paper.pdf',
      size_bytes: 1_256_000,
    });
  });

  it('persists a document as its original local-file reference without creating a managed copy', async () => {
    const { service, workspaceId, managedFiles } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });

    const result = await service.saveUserMessage({
      message_id: 'M-document',
      session_id: 'S1',
      display_content: [{ type: 'text', text: '总结文档' }], model_content: [{ type: 'text', text: '总结文档' }],
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
          ordinal: 0,
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
      display_content: [{ type: 'text', text: 'hello' }], model_content: [{ type: 'text', text: 'hello' }],
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
      display_content: [{ type: 'text', text: 'hello' }], model_content: [{ type: 'text', text: 'hello' }], created_at: '2026-07-04T00:01:00.000Z',
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

  it('persists all four semantic message variants without a second history format', async () => {
    const { service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'U1', session_id: 'S1', run_id: 'R1',
      display_content: [{ type: 'text', text: 'question' }], model_content: [{ type: 'text', text: 'question' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    service.saveModelResponse({
      message_id: 'M1', session_id: 'S1', run_id: 'R1',
      content: [{ type: 'text', text: 'working' }],
      outcome_status: 'incomplete', stop_reason: 'tool_use',
      completed_at: '2026-07-04T00:02:00.000Z',
    });
    service.saveToolResultMessage({
      message_id: 'T1', session_id: 'S1', run_id: 'R1',
      tool_call_id: 'call:1', tool_name: 'read_file', status: 'cancelled',
      content: [{ type: 'text', text: 'cancelled' }],
      completed_at: '2026-07-04T00:03:00.000Z',
    });
    service.saveAssistantReply({
      message_id: 'A1', session_id: 'S1', run_id: 'R1',
      status: 'cancelled', reason_code: 'user_cancelled', content: [],
      completed_at: '2026-07-04T00:04:00.000Z',
    });

    expect(service.listMessages({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      messages: [
        { message: { message_kind: 'user_message' } },
        { message: { message_kind: 'model_response', outcome_status: 'incomplete' } },
        { message: { message_kind: 'tool_result', status: 'cancelled', tool_call_id: 'call:1' } },
        { message: { message_kind: 'assistant_reply', status: 'cancelled' } },
      ],
    });
  });

  it('replays the same message identity idempotently and rejects conflicting content', async () => {
    const { service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const request = {
      message_id: 'M-idempotent',
      session_id: 'S1',
      run_id: 'R-idempotent',
      display_content: [{ type: 'text' as const, text: 'same input' }],
      model_content: [{ type: 'text' as const, text: 'same input' }],
      created_at: '2026-07-04T00:01:00.000Z',
    };

    const first = await service.saveUserMessage(request);
    const repeated = await service.saveUserMessage(request);
    const conflict = await service.saveUserMessage({
      ...request,
      display_content: [{ type: 'text', text: 'different input' }], model_content: [{ type: 'text', text: 'different input' }],
    });

    expect(first.status).toBe('saved');
    expect(repeated).toEqual(first);
    expect(conflict).toMatchObject({
      status: 'failed',
      failure: { code: 'message_identity_conflict' },
    });
    expect(service.listMessages({ session_id: 'S1' })).toMatchObject({
      status: 'ok',
      messages: [{ message: { message_id: 'M-idempotent' } }],
    });
  });

  it('rejects the same message identity when managed image content differs', async () => {
    const { service, workspaceId, managedFiles } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const request = {
      message_id: 'M-image-idempotent',
      session_id: 'S1',
      display_content: [{ type: 'text' as const, text: 'inspect image' }],
      model_content: [{ type: 'text' as const, text: 'inspect image' }],
      attachments: [{
        type: 'image' as const,
        name: 'image.png',
        media_type: 'image/png' as const,
        byte_length: 3,
        bytes: new Uint8Array([1, 2, 3]),
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    };

    const first = await service.saveUserMessage(request);
    const repeated = await service.saveUserMessage({
      ...request,
      attachments: [{ ...request.attachments[0], bytes: new Uint8Array([1, 2, 3]) }],
    });
    const conflict = await service.saveUserMessage({
      ...request,
      attachments: [{ ...request.attachments[0], bytes: new Uint8Array([1, 2, 4]) }],
    });

    expect(first.status).toBe('saved');
    expect(repeated).toEqual(first);
    expect(conflict).toMatchObject({
      status: 'failed',
      failure: { code: 'message_identity_conflict' },
    });
    expect(managedFiles.get('A1/original.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(managedFiles.size).toBe(1);
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
      message_id: 'M1', session_id: 'S1', display_content: [{ type: 'text', text: 'first' }], model_content: [{ type: 'text', text: 'first' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') return;
    await service.saveUserMessage({
      message_id: 'M2', session_id: 'S1', display_content: [{ type: 'text', text: 'new branch head' }], model_content: [{ type: 'text', text: 'new branch head' }],
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
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', display_content: [{ type: 'text', text: 'm1' }], model_content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    await service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: [{ type: 'text', text: 'm2' }], completed_at: '2026-07-04T00:02:00.000Z' });
    await service.switchActiveEntry({ session_id: 'S1', active_entry_id: m1.status === 'saved' ? m1.entry.entry_id : undefined, updated_at: '2026-07-04T00:03:00.000Z' });
    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', display_content: [{ type: 'text', text: 'm3' }], model_content: [{ type: 'text', text: 'm3' }], created_at: '2026-07-04T00:04:00.000Z' });

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
      message_id: 'M-image', session_id: 'S1', display_content: [], model_content: [],
      attachments: [{ type: 'image', name: 'image.png', media_type: 'image/png', byte_length: bytes.byteLength, bytes }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    expect(saved.status).toBe('saved');
    expect(await service.readAttachmentContent({ attachment_id: 'A1' })).toEqual({
      status: 'ok', content: { bytes, media_type: 'image/png' },
    });

    const failed = await service.saveUserMessage({
      message_id: 'M-missing', session_id: 'missing', display_content: [], model_content: [],
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
      display_content: [{ type: 'text', text: 'first input' }], model_content: [{ type: 'text', text: 'first input' }],
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
      display_content: [{ type: 'text', text: 'second input' }], model_content: [{ type: 'text', text: 'second input' }],
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
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', display_content: [{ type: 'text', text: 'm1' }], model_content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    const firstEntryId = m1.status === 'saved' ? m1.entry.entry_id : 'missing';
    await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', display_content: [{ type: 'text', text: 'm2' }], model_content: [{ type: 'text', text: 'm2' }], created_at: '2026-07-04T00:02:00.000Z' });
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
    const first = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', display_content: [{ type: 'text', text: 'm1' }], model_content: [{ type: 'text', text: 'm1' }], created_at: '2026-07-04T00:01:00.000Z' });
    const second = await service.saveUserMessage({ message_id: 'M2', session_id: 'S1', display_content: [{ type: 'text', text: 'm2' }], model_content: [{ type: 'text', text: 'm2' }], created_at: '2026-07-04T00:02:00.000Z' });
    const firstEntryId = first.status === 'saved' ? first.entry.entry_id : 'missing';
    const expectedHead = second.status === 'saved' ? second.entry.entry_id : 'missing';

    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', display_content: [{ type: 'text', text: 'new branch head' }], model_content: [{ type: 'text', text: 'new branch head' }], created_at: '2026-07-04T00:03:00.000Z' });

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

  it('round-trips real Model metadata and Usage for model responses and assistant replies', async () => {
    const { service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'U1', session_id: 'S1', run_id: 'R1',
      display_content: [{ type: 'text', text: 'question' }], model_content: [{ type: 'text', text: 'question' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    const usage = {
      input: 10, output: 5, cacheRead: 2, cacheWrite: 3,
      totalTokens: 20, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    };
    service.saveModelResponse({
      message_id: 'M1', session_id: 'S1', run_id: 'R1',
      content: [{ type: 'text', text: 'working' }],
      outcome_status: 'incomplete', stop_reason: 'tool_use',
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude-x',
      response_model: 'claude-y', response_id: 'resp:1',
      usage,
      completed_at: '2026-07-04T00:02:00.000Z',
    });
    service.saveAssistantReply({
      message_id: 'A1', session_id: 'S1', run_id: 'R1',
      status: 'completed', reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'done' }],
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude-x', response_id: 'resp:2',
      usage,
      completed_at: '2026-07-04T00:03:00.000Z',
    });

    const listed = service.listMessages({ session_id: 'S1' });
    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    const modelResponse = listed.messages.find((item) => item.message.message_kind === 'model_response');
    const reply = listed.messages.find((item) => item.message.message_kind === 'assistant_reply');
    expect(modelResponse?.message).toMatchObject({
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude-x',
      response_model: 'claude-y', response_id: 'resp:1', usage, stop_reason: 'tool_use',
    });
    expect(reply?.message).toMatchObject({
      api: 'anthropic-messages', provider: 'anthropic', model: 'claude-x',
      response_id: 'resp:2', usage,
    });
  });

  it('round-trips optional ToolResult Usage', async () => {
    const { service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({
      message_id: 'U1', session_id: 'S1', run_id: 'R1',
      display_content: [{ type: 'text', text: 'question' }], model_content: [{ type: 'text', text: 'question' }],
      created_at: '2026-07-04T00:01:00.000Z',
    });
    service.saveModelResponse({
      message_id: 'M1', session_id: 'S1', run_id: 'R1',
      content: [{ type: 'toolCall', id: 'call:1', name: 'read_file', argumentsText: '{"path":"a"}' }],
      outcome_status: 'completed', stop_reason: 'tool_use',
      completed_at: '2026-07-04T00:02:00.000Z',
    });
    const usage = {
      input: 4, output: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    service.saveToolResultMessage({
      message_id: 'T1', session_id: 'S1', run_id: 'R1',
      tool_call_id: 'call:1', tool_name: 'read_file', status: 'success',
      content: [{ type: 'text', text: 'content' }],
      usage,
      completed_at: '2026-07-04T00:03:00.000Z',
    });

    const listed = service.listMessages({ session_id: 'S1' });
    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    const toolResult = listed.messages.find((item) => item.message.message_kind === 'tool_result');
    expect(toolResult?.message).toMatchObject({ tool_call_id: 'call:1', usage });
  });

  it('reads legacy single-content user messages as display and model content', async () => {
    const { database, service, workspaceId } = createService();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    // Simulate a record written before display_content/model_content existed.
    database.prepare({
      sql: `
        INSERT INTO session_messages (
          message_id, session_id, run_id, message_kind, message_json, created_at, completed_at
        ) VALUES (?, ?, ?, 'user_message', ?, ?, ?)
      `,
    }).run([
      'legacy:1',
      'S1',
      'R1',
      JSON.stringify({ content: [{ type: 'text', text: 'legacy question' }], legacy_provenance: { source: 'pre_final_reply_semantics' } }),
      '2026-07-04T00:01:00.000Z',
      '2026-07-04T00:01:00.000Z',
    ]);

    const listed = service.listMessages({ session_id: 'S1' });
    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    const message = listed.messages[0]?.message;
    expect(message).toMatchObject({
      message_kind: 'user_message',
      display_content: [{ type: 'text', text: 'legacy question' }],
      model_content: [{ type: 'text', text: 'legacy question' }],
    });
    expect('skill_selection' in message).toBe(false);
  });

  it('rejects a document replay whose sizeBytes disagrees with the persisted record', async () => {
    const { service, workspaceId } = createService();
    await service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const request = {
      message_id: 'M-size-conflict',
      session_id: 'S1',
      display_content: [{ type: 'text' as const, text: '带附件' }],
      model_content: [{ type: 'text' as const, text: '带附件' }],
      attachments: [{
        type: 'file' as const,
        name: 'paper.pdf',
        media_type: 'application/pdf',
        local_path: 'C:/materials/paper.pdf',
        size_bytes: 1_256_000,
      }],
      created_at: '2026-07-04T00:01:00.000Z',
    };
    const first = await service.saveUserMessage(request);
    expect(first.status).toBe('saved');

    const conflicting = await service.saveUserMessage({
      ...request,
      attachments: [{ ...request.attachments![0]!, size_bytes: 999 }],
    });
    expect(conflicting).toMatchObject({
      status: 'failed',
      failure: { code: 'message_identity_conflict' },
    });
  });
});
