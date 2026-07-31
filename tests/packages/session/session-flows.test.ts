import { describe, expect, it } from 'vitest';
import {
  createSessionCatalog,
  createSessionEntryGraph,
  createSessionHistory,
  type SessionStore,
} from '../../../packages/session/src/index';
import { createSessionStore } from '@megumi/session/store';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src/index';

function createTestDatabase() {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return database;
}

function seedWorkspace(database: DatabaseConnection): string {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:session-flow-test', 'session-flow-test', 'C:/workspaces/session-flow-test',
      'c:/workspaces/session-flow-test', 'available',
      '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z'
    )
  ` }).run();
  return 'workspace:session-flow-test';
}

function createHarness() {
  const database = createTestDatabase();
  const workspaceId = seedWorkspace(database);
  const repository = createSessionStore({ database });
  const service = createService(repository, 'S1');
  return { repository, service, workspaceId };
}

function createService(repository: SessionStore, sessionId: string) {
  const ids = {
    sessionId: () => sessionId,
    entryId: ({ kind, source_id }: { kind: 'message' | 'compaction'; source_id: string }) => `${kind}:${source_id}`,
  };
  return {
    ...createSessionCatalog({
      store: repository,
      ids,
      now: () => '2026-07-04T00:00:00.000Z',
    }),
    ...createSessionHistory({
      store: repository,
      ids,
    }),
    ...createSessionEntryGraph({
      store: repository,
    }),
  };
}

describe('session service flows', () => {
  it('creates a branch by switching active entry and saving a new message', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content: text('m1'), created_at: '2026-07-04T00:01:00.000Z' });
    service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: text('m2'), completed_at: '2026-07-04T00:02:00.000Z' });
    await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', content: text('m3'), created_at: '2026-07-04T00:03:00.000Z' });

    const branchPoint = m1.status === 'saved' ? m1.entry.entry_id : undefined;
    service.switchActiveEntry({ session_id: 'S1', active_entry_id: branchPoint, updated_at: '2026-07-04T00:04:00.000Z' });
    await service.saveUserMessage({ message_id: 'M4', session_id: 'S1', content: text('m4'), created_at: '2026-07-04T00:05:00.000Z' });

    const result = service.listMessages({ session_id: 'S1', active_path_only: true });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.messages.map((item) => item.message.message_id)).toEqual(['M1', 'M4']);
    }
  });

  it('creates a branch by saving the next user message under an explicit parent entry', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    await service.saveUserMessage({ message_id: 'U1', session_id: 'S1', content: text('u1'), created_at: '2026-07-04T00:01:00.000Z' });
    const a1 = service.saveAssistantReply({ message_id: 'A1', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: text('a1'), completed_at: '2026-07-04T00:02:00.000Z' });
    await service.saveUserMessage({ message_id: 'U2', session_id: 'S1', content: text('u2'), created_at: '2026-07-04T00:03:00.000Z' });
    service.saveAssistantReply({ message_id: 'A2', session_id: 'S1', run_id: 'R2', status: 'completed', reason_code: 'normal_completion', content: text('a2'), completed_at: '2026-07-04T00:04:00.000Z' });

    await service.saveUserMessage({
      message_id: 'U3',
      session_id: 'S1',
      content: text('u3'),
      parent_entry_id: a1.status === 'saved' ? a1.entry.entry_id : 'missing',
      created_at: '2026-07-04T00:05:00.000Z',
    });

    const result = service.listMessages({ session_id: 'S1', active_path_only: true });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.messages.map((item) => item.message.message_id)).toEqual(['U1', 'A1', 'U3']);
    }

    expect(service.getActiveHistory({
      session_id: 'S1',
      through_entry_id: a1.status === 'saved' ? a1.entry.entry_id : 'missing',
    })).toMatchObject({
      status: 'ok',
      history: [
        { type: 'message', message: { message_id: 'U1' } },
        { type: 'message', message: { message_id: 'A1' } },
      ],
    });
    expect(service.getActiveHistory({ session_id: 'S1', through_entry_id: null })).toEqual({
      status: 'ok',
      history: [],
    });
  });

  it('rejects history through an entry owned by another session', async () => {
    const { repository, service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const otherService = createService(repository, 'S2');
    otherService.createSession({ workspace_id: workspaceId, title: 'Other session' });
    const otherMessage = await otherService.saveUserMessage({
      message_id: 'OTHER',
      session_id: 'S2',
      content: text('other'),
      created_at: '2026-07-04T00:01:00.000Z',
    });

    expect(service.getActiveHistory({
      session_id: 'S1',
      through_entry_id: otherMessage.status === 'saved' ? otherMessage.entry.entry_id : 'missing',
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'invalid_through_entry' },
    });
  });

  it('uses compaction summary in active history and skips it in active message listing', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', content: text('m1'), created_at: '2026-07-04T00:01:00.000Z' });
    const m2 = service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: text('m2'), completed_at: '2026-07-04T00:02:00.000Z' });
    const firstKeptEntryId = m2.status === 'saved' ? m2.entry.entry_id : undefined;
    service.saveCompactionSummary({
      compaction_id: 'C1',
      session_id: 'S1',
      summary_text: 'm1 summary',
      covered_until_entry_id: m1.status === 'saved' ? m1.entry.entry_id : 'missing',
      first_kept_entry_id: firstKeptEntryId,
      created_at: '2026-07-04T00:03:00.000Z',
      append_to_active_path: true,
    });

    const activeMessages = service.listMessages({ session_id: 'S1', active_path_only: true });
    const activeHistory = service.getActiveHistory({ session_id: 'S1' });

    expect(activeMessages.status).toBe('ok');
    if (activeMessages.status === 'ok') {
      expect(activeMessages.messages.map((item) => item.message.message_id)).toEqual(['M2']);
    }
    expect(activeHistory.status).toBe('ok');
    if (activeHistory.status === 'ok') {
      expect(activeHistory.history.map((item) => item.type)).toEqual(['compaction', 'message']);
    }
  });

  it('expands compaction boundaries when reading the active conversation for UI', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', run_id: 'R1', content: text('m1'), created_at: '2026-07-04T00:01:00.000Z' });
    const m2 = service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: text('m2'), completed_at: '2026-07-04T00:02:00.000Z' });
    const m3 = await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', run_id: 'R2', content: text('m3'), created_at: '2026-07-04T00:03:00.000Z' });
    service.saveAssistantReply({ message_id: 'M4', session_id: 'S1', run_id: 'R2', status: 'completed', reason_code: 'normal_completion', content: text('m4'), completed_at: '2026-07-04T00:04:00.000Z' });
    service.saveCompactionSummary({
      compaction_id: 'C1',
      session_id: 'S1',
      summary_text: 'm1 and m2 summary',
      covered_until_entry_id: m2.status === 'saved' ? m2.entry.entry_id : 'missing',
      first_kept_entry_id: m3.status === 'saved' ? m3.entry.entry_id : undefined,
      created_at: '2026-07-04T00:05:00.000Z',
      append_to_active_path: true,
    });

    const conversation = service.getActiveConversationHistory({ session_id: 'S1' });

    expect(conversation.status).toBe('ok');
    if (conversation.status === 'ok') {
      expect(conversation.messages.map((item) => item.message.message_id)).toEqual(['M1', 'M2', 'M3', 'M4']);
    }
    expect(m1.status).toBe('saved');
  });

  it('expands nested rolling compactions without duplicating conversation messages', async () => {
    const { service, workspaceId } = createHarness();
    service.createSession({ workspace_id: workspaceId, title: 'Session' });
    const m1 = await service.saveUserMessage({ message_id: 'M1', session_id: 'S1', run_id: 'R1', content: text('m1'), created_at: '2026-07-04T00:01:00.000Z' });
    const m2 = service.saveAssistantReply({ message_id: 'M2', session_id: 'S1', run_id: 'R1', status: 'completed', reason_code: 'normal_completion', content: text('m2'), completed_at: '2026-07-04T00:02:00.000Z' });
    const m3 = await service.saveUserMessage({ message_id: 'M3', session_id: 'S1', run_id: 'R2', content: text('m3'), created_at: '2026-07-04T00:03:00.000Z' });
    const m4 = service.saveAssistantReply({ message_id: 'M4', session_id: 'S1', run_id: 'R2', status: 'completed', reason_code: 'normal_completion', content: text('m4'), completed_at: '2026-07-04T00:04:00.000Z' });
    const m5 = await service.saveUserMessage({ message_id: 'M5', session_id: 'S1', run_id: 'R3', content: text('m5'), created_at: '2026-07-04T00:05:00.000Z' });
    service.saveAssistantReply({ message_id: 'M6', session_id: 'S1', run_id: 'R3', status: 'completed', reason_code: 'normal_completion', content: text('m6'), completed_at: '2026-07-04T00:06:00.000Z' });
    service.saveCompactionSummary({
      compaction_id: 'C1', session_id: 'S1', summary_text: 'first summary',
      covered_until_entry_id: m2.status === 'saved' ? m2.entry.entry_id : 'missing',
      first_kept_entry_id: m3.status === 'saved' ? m3.entry.entry_id : undefined,
      created_at: '2026-07-04T00:07:00.000Z', append_to_active_path: true,
    });
    service.saveCompactionSummary({
      compaction_id: 'C2', session_id: 'S1', summary_text: 'replacement summary',
      covered_until_entry_id: m4.status === 'saved' ? m4.entry.entry_id : 'missing',
      first_kept_entry_id: m5.status === 'saved' ? m5.entry.entry_id : undefined,
      created_at: '2026-07-04T00:08:00.000Z', append_to_active_path: true,
    });

    const conversation = service.getActiveConversationHistory({ session_id: 'S1' });

    expect(conversation.status).toBe('ok');
    if (conversation.status === 'ok') {
      expect(conversation.messages.map((item) => item.message.message_id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
    }
    const completedRun = service.getActiveConversationHistory({ session_id: 'S1', run_id: 'R3' });
    expect(completedRun.status).toBe('ok');
    if (completedRun.status === 'ok') {
      expect(completedRun.messages.map((item) => item.message.message_id)).toEqual(['M5', 'M6']);
    }
    expect(m1.status).toBe('saved');
  });
});

function text(value: string) {
  return [{ type: 'text' as const, text: value }];
}
