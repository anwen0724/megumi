/* Verifies Session-message-only construction of factual historical Turns. */
import { describe, expect, it } from 'vitest';
import type { SessionConversationMessage, SessionHistoryItem } from '@megumi/coding-agent/session';
import { buildConversationTurns } from '@megumi/coding-agent/context/service/internal/conversation-turn-builder';

describe('buildConversationTurns', () => {
  it('groups complete semantic messages by run_id without a Run history query', () => {
    const history: SessionHistoryItem[] = [
      message('EU1', 'U1', 'R1', { role: 'user', content: text('read it') }),
      message('EA1', 'A1', 'R1', {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'toolCall', id: 'T1', name: 'read_file', argumentsText: '{"path":"README.md"}' },
        ],
      }),
      message('ET1', 'TR1', 'R1', {
        role: 'toolResult', toolCallId: 'T1', toolName: 'read_file', status: 'success', content: text('content'),
      }),
      message('EA2', 'A2', 'R1', { role: 'assistant', content: text('done') }),
      message('EU2', 'U2', 'R2', { role: 'user', content: text('cancel now') }),
    ];

    const result = buildConversationTurns({ history });

    expect(result.turns.map((turn) => turn.source.runId)).toEqual(['R1', 'R2']);
    expect(result.turns[0]).toMatchObject({
      source: {
        userEntryId: 'EU1', lastEntryId: 'EA2',
        responseMessageRefs: [{ entryId: 'EA1' }, { entryId: 'ET1' }, { entryId: 'EA2' }],
      },
      items: [
        { type: 'assistant_message', content: text('checking') },
        { type: 'tool_call', toolCallId: 'T1', arguments: { path: 'README.md' } },
        { type: 'tool_result', toolCallId: 'T1', status: 'success', content: text('content') },
        { type: 'assistant_message', content: text('done') },
      ],
    });
    expect(result.turns[1]).toMatchObject({ source: { lastEntryId: 'EU2' }, items: [] });
  });

  it('keeps an incomplete tool request as ordinary historical content', () => {
    const result = buildConversationTurns({
      history: [
        message('EU', 'U', 'R', { role: 'user', content: text('write') }),
        message('EA', 'A', 'R', {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'T', name: 'write_file', argumentsText: '{bad-json' }],
          stopReason: 'cancelled',
        }),
      ],
    });

    expect(result.turns[0].items).toEqual([{
      type: 'assistant_message',
      content: [{
        type: 'json',
        value: {
          historicalRunId: 'R',
          incompleteToolCalls: [{ id: 'T', name: 'write_file', argumentsText: '{bad-json' }],
        },
      }],
    }]);
  });
});

function message(
  entryId: string,
  messageId: string,
  runId: string,
  conversation: SessionConversationMessage,
): Extract<SessionHistoryItem, { type: 'message' }> {
  return {
    type: 'message',
    entry: { entry_id: entryId, session_id: 'S1', entry_type: 'message', message_id: messageId, created_at: 'now' },
    message: { message_id: messageId, session_id: 'S1', run_id: runId, conversation, created_at: 'now' },
    attachments: [],
  };
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }];
}
