/* Verifies the public Session Timeline query against Session's stable read contract. */
import { describe, expect, it, vi } from 'vitest';
import type { SessionMessageWithAttachments } from '@megumi/session';
import {
  createSessionTimelineQuery,
} from '../../../packages/projections/src/index';

const MESSAGES: SessionMessageWithAttachments[] = [
  {
    message: {
      message_id: 'user:2',
      message_kind: 'user_message',
      session_id: 'session:1',
      run_id: 'run:2',
      display_content: [{ type: 'text', text: 'second' }],
      model_content: [{ type: 'text', text: 'second' }],
      created_at: '2026-07-12T00:00:03.000Z',
    },
    attachments: [],
    active_path_order: 2,
  },
  {
    message: {
      message_id: 'assistant:2',
      message_kind: 'assistant_reply',
      session_id: 'session:1',
      run_id: 'run:2',
      status: 'completed',
      reason_code: 'normal_completion',
      content: [{ type: 'text', text: 'two' }],
      created_at: '2026-07-12T00:00:04.000Z',
      completed_at: '2026-07-12T00:00:04.000Z',
    },
    attachments: [],
    active_path_order: 3,
  },
];

describe('SessionTimelineQuery', () => {
  it('forwards a requested Run and retains its active-path order', () => {
    const getActiveConversationHistory = vi.fn(() => ({
      status: 'ok' as const,
      messages: MESSAGES,
    }));
    const query = createSessionTimelineQuery({
      sessionHistory: { getActiveConversationHistory },
    });

    const result = query.list({
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      runId: 'run:2',
    });

    expect(getActiveConversationHistory).toHaveBeenCalledWith({
      session_id: 'session:1',
      run_id: 'run:2',
    });
    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'user', runId: 'run:2', historyOrder: 2 }),
      expect.objectContaining({ role: 'assistant', runId: 'run:2', historyOrder: 3 }),
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('isolates Session and optional footer projection failures', () => {
    const failedQuery = createSessionTimelineQuery({
      sessionHistory: {
        getActiveConversationHistory: () => ({
          status: 'failed',
          failure: { code: 'session_unavailable', message: 'Session is unavailable.' },
        }),
      },
    });
    expect(failedQuery.list({ workspaceId: 'workspace:1', sessionId: 'session:1' })).toEqual({
      messages: [],
      diagnostics: [{
        messageId: 'session:session:1',
        code: 'session_unavailable',
        message: 'Session is unavailable.',
      }],
    });

    const query = createSessionTimelineQuery({
      sessionHistory: {
        getActiveConversationHistory: () => ({ status: 'ok', messages: MESSAGES }),
      },
      workspaceChangeFooterProjector: {
        project: () => { throw new Error('footer unavailable'); },
      },
    });
    const result = query.list({ workspaceId: 'workspace:1', sessionId: 'session:1' });
    expect(result.messages).toHaveLength(2);
    expect(result.diagnostics).toEqual([{
      messageId: 'assistant:run:2',
      code: 'workspace_change_footer_projection_failed',
      message: 'footer unavailable',
    }]);
  });
});
