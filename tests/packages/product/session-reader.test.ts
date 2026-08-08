import { describe, expect, it } from 'vitest';
import { createSessionReader } from '../../../packages/product/src/operations/session/session-reader';

const session = {
  session_id: 'session:1',
  workspace_id: 'workspace:1',
  title: 'Session',
  status: 'active' as const,
  created_at: '2026-07-04T00:00:00.000Z',
  updated_at: '2026-07-04T00:00:01.000Z',
};

const userMessage = {
  message_id: 'message:1',
  session_id: session.session_id,
  run_id: 'run:1',
  message_kind: 'user_message' as const,
  display_content: [{ type: 'text' as const, text: 'hello' }],
  model_content: [{ type: 'text' as const, text: '<skill>private</skill>\nhello' }],
  created_at: '2026-07-04T00:00:02.000Z',
  completed_at: '2026-07-04T00:00:02.000Z',
};

const messageItem = {
  type: 'message' as const,
  entryId: 'entry:1',
  message: userMessage,
  attachments: [],
};

describe('Product Session reader', () => {
  it('combines Owner facts without exposing modelContent or failing on optional Workspace reads', async () => {
    const reader = createSessionReader({
      sessions: { getSession: () => ({ status: 'found', session }) },
      history: {
        getActiveConversationHistory: () => ({
          status: 'ok',
          conversation: [messageItem, {
            type: 'compaction',
            compactionId: 'compaction:1',
            sessionId: session.session_id,
            anchorEntryId: 'entry:1',
            trigger: 'manual',
            status: 'failed',
            error: { code: 'summary_failed', message: 'failed' },
            startedAt: '2026-07-04T00:00:03.000Z',
            completedAt: '2026-07-04T00:00:04.000Z',
          }],
        }),
        getCommittedRunMessages: () => ({ status: 'ok', messages: [messageItem] }),
      },
      runs: {
        getActive: () => ({
          status: 'found',
          run: {
            runId: 'run:1', requestId: 'request:1', workspaceId: 'workspace:1',
            sessionId: 'session:1', userMessageId: 'message:1',
            model: {} as never, permissionMode: 'ask', status: 'waiting',
            createdAt: '2026-07-04T00:00:02.000Z', startedAt: '2026-07-04T00:00:02.000Z',
          },
        }),
      },
      events: {
        read: () => ({
          events: [], firstSequence: 3, lastSequence: 4, truncated: true,
        }),
      },
      workspaceChanges: {
        listChangeSummaries: () => { throw new Error('workspace store unavailable'); },
      },
    });

    const result = await reader.readSession({ sessionId: session.session_id });

    expect(result).toMatchObject({
      status: 'ok',
      session: { id: session.session_id, projectId: session.workspace_id },
      activeRun: { runId: 'run:1', status: 'waiting' },
      eventRange: { firstSequence: 3, lastSequence: 4, truncated: true },
      diagnostics: [{ code: 'workspace_changes_unavailable', runId: 'run:1' }],
      conversation: [
        { type: 'message', entryId: 'entry:1', message: { kind: 'user', displayContent: [{ text: 'hello' }] } },
        { type: 'compaction', compactionId: 'compaction:1', status: 'failed' },
      ],
    });
    if (result.status === 'ok' && result.conversation[0]?.type === 'message') {
      expect(result.conversation[0].message).not.toHaveProperty('modelContent');
    }
  });

  it('reads one committed Run without consulting Engine or Events', async () => {
    let engineReads = 0;
    let eventReads = 0;
    const reader = createSessionReader({
      sessions: { getSession: () => ({ status: 'found', session }) },
      history: {
        getActiveConversationHistory: () => ({ status: 'ok', conversation: [] }),
        getCommittedRunMessages: () => ({ status: 'ok', messages: [messageItem] }),
      },
      runs: { getActive: () => { engineReads += 1; return { status: 'not_found', sessionId: session.session_id }; } },
      events: { read: () => { eventReads += 1; return { events: [], truncated: false }; } },
      workspaceChanges: { listChangeSummaries: () => ({ summaries: [] }) },
    });

    const result = await reader.readCommittedRun({ sessionId: session.session_id, runId: 'run:1' });

    expect(result).toMatchObject({ status: 'ok', messages: [{ entryId: 'entry:1' }] });
    expect({ engineReads, eventReads }).toEqual({ engineReads: 0, eventReads: 0 });
  });
});
