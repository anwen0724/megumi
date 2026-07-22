/* Verifies Context construction from explicit Session message variants. */
import { describe, expect, it } from 'vitest';
import type { SessionHistoryItem, SessionMessage } from '@megumi/agent/session';
import { buildConversationRuns } from '@megumi/agent/context/service/internal/conversation-run-builder';

describe('buildConversationRuns', () => {
  it('preserves Work Tool history and the final Assistant Reply as different facts', () => {
    const history: SessionHistoryItem[] = [
      message('EU1', user('U1', 'R1', 'read it')),
      message('EM1', {
        ...base('M1', 'R1'), message_kind: 'model_response', outcome_status: 'completed',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'thinking', thinking: 'Need the file contents.' },
          { type: 'toolCall', id: 'T1', name: 'read_file', argumentsText: '{"path":"README.md"}' },
        ],
      }),
      message('ET1', {
        ...base('TR1', 'R1'), message_kind: 'tool_result', tool_call_id: 'T1',
        tool_name: 'read_file', status: 'success', content: text('content'),
      }),
      message('EA1', reply('A1', 'R1', 'completed', 'done')),
      message('EU2', user('U2', 'R2', 'old request')),
    ];

    const result = buildConversationRuns({ history });

    expect(result.runs[0]).toMatchObject({
      source: { userEntryId: 'EU1', lastEntryId: 'EA1' },
      items: [
        { type: 'assistant_message', content: [
          { type: 'text', text: 'checking' },
          { type: 'thinking', thinking: 'Need the file contents.' },
        ] },
        { type: 'tool_call', toolCallId: 'T1', arguments: { path: 'README.md' } },
        { type: 'tool_result', toolCallId: 'T1', status: 'success', content: text('content') },
        { type: 'assistant_message', content: text('done') },
      ],
    });
    expect(result.runs[1].items).toEqual([]);
  });

  it('does not invent a status message for a reply-less Run', () => {
    const result = buildConversationRuns({
      history: [message('EU', user('U', 'R', 'working'))],
    });
    expect(result.runs[0].items).toEqual([]);
  });

  it('preserves an incomplete Work Tool intent without inserting synthetic run-state messages', () => {
    const result = buildConversationRuns({
      history: [
        message('EU', user('U', 'R', 'write')),
        message('EM', {
          ...base('M', 'R'), message_kind: 'model_response', outcome_status: 'incomplete',
          reason_code: 'user_cancelled',
          content: [{ type: 'toolCall', id: 'T', name: 'write_file', argumentsText: '{bad-json' }],
        }),
        message('EA', reply('A', 'R', 'cancelled', '')),
      ],
    });
    expect(result.runs[0].items).toEqual([
      { type: 'tool_call', toolCallId: 'T', toolName: 'write_file', arguments: '{bad-json' },
    ]);
  });
});

function base(messageId: string, runId: string) {
  return { message_id: messageId, session_id: 'S1', run_id: runId, created_at: 'now', completed_at: 'now' };
}

function user(messageId: string, runId: string, value: string): SessionMessage {
  return { ...base(messageId, runId), message_kind: 'user_message', content: text(value) };
}

function reply(messageId: string, runId: string, status: 'completed' | 'cancelled', value: string): SessionMessage {
  return {
    ...base(messageId, runId), message_kind: 'assistant_reply', status,
    reason_code: status === 'completed' ? 'normal_completion' : 'user_cancelled',
    content: value ? text(value) : [],
  };
}

function message(
  entryId: string,
  value: SessionMessage,
): Extract<SessionHistoryItem, { type: 'message' }> {
  return {
    type: 'message',
    entry: { entry_id: entryId, session_id: 'S1', entry_type: 'message', message_id: value.message_id, created_at: 'now' },
    message: value,
    attachments: [],
  };
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }];
}
