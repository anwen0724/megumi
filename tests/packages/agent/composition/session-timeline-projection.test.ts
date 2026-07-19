/* Verifies historical Timeline projection from explicit Session variants. */
import { describe, expect, it } from 'vitest';
import {
  projectSessionTimelineMessages,
  type TimelineAssistantMessage,
} from '@megumi/agent/projections/timeline';
import type {
  SessionMessage,
  SessionMessageWithAttachments,
  SessionUserMessage,
} from '@megumi/agent/session';

describe('Session Timeline projection', () => {
  it('keeps text plus Work Tool Call in process and uses only Assistant Reply as answer', () => {
    const messages = [
      item(user('U1', 'inspect')),
      item({
        ...base('M1'),
        message_kind: 'model_response',
        outcome_status: 'completed',
        stop_reason: 'tool_calls',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'toolCall', id: 'T1', name: 'read_file', argumentsText: '{"path":"README.md"}' },
        ],
      }),
      item({
        ...base('T1-result'),
        message_kind: 'tool_result',
        tool_call_id: 'T1',
        tool_name: 'read_file',
        status: 'success',
        content: [{ type: 'text', text: 'contents' }],
      }),
      item(reply('A1', 'completed', 'Done.')),
    ];

    const projected = projectSessionTimelineMessages({ projectId: 'P1', messages });
    const assistant = projected[1] as TimelineAssistantMessage;
    expect(assistant.messageId).toBe('A1');
    expect(assistant.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'process_disclosure',
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'assistant_text', text: 'I will inspect it.' }),
          expect.objectContaining({ kind: 'tool_activity', toolCallId: 'T1', status: 'succeeded' }),
        ]),
      }),
      expect.objectContaining({ kind: 'answer_text', status: 'completed', text: 'Done.' }),
    ]));
  });

  it('projects thinking from a direct Assistant Reply into process disclosure', () => {
    const messages = [
      item(user('U1', 'hello')),
      item({
        ...base('A1'),
        message_kind: 'assistant_reply',
        status: 'completed',
        reason_code: 'normal_completion',
        content: [
          { type: 'thinking', thinking: 'I should answer warmly.' },
          { type: 'text', text: 'Hello!' },
        ],
      }),
    ];

    const projected = projectSessionTimelineMessages({ projectId: 'P1', messages });
    const assistant = projected[1] as TimelineAssistantMessage;
    expect(assistant.blocks).toEqual([
      expect.objectContaining({
        kind: 'process_disclosure',
        items: [expect.objectContaining({
          kind: 'thinking',
          text: 'I should answer warmly.',
          status: 'completed',
        })],
      }),
      expect.objectContaining({ kind: 'answer_text', status: 'completed', text: 'Hello!' }),
    ]);
  });

  it.each([
    ['failed', 'Partial answer.', 'failed'],
    ['cancelled', '', 'cancelled'],
  ] as const)('renders %s Assistant Reply directly, including an empty reply', (status, text, expected) => {
    const projected = projectSessionTimelineMessages({
      projectId: 'P1',
      messages: [item(user('U1', 'hello')), item(reply('A1', status, text))],
    });
    const assistant = projected[1] as TimelineAssistantMessage;
    expect(assistant.blocks).toContainEqual(expect.objectContaining({
      kind: 'answer_text', status: expected, text,
    }));
  });

  it('projects a new reply-less historical Run as interrupted but does not synthesize it while live', () => {
    const messages = [item(user('U1', 'hello'))];
    const historical = projectSessionTimelineMessages({ projectId: 'P1', messages });
    expect((historical[1] as TimelineAssistantMessage).blocks).toContainEqual(expect.objectContaining({
      kind: 'answer_text', status: 'interrupted', text: '',
    }));

    const live = projectSessionTimelineMessages({ projectId: 'P1', messages, isRunLive: () => true });
    expect(live).toHaveLength(1);
  });

  it('does not claim completion for a migrated legacy response', () => {
    const messages = [
      item({ ...user('U1', 'hello'), legacy_provenance: { source: 'pre_final_reply_semantics' } }),
      item({
        ...base('M1'),
        message_kind: 'model_response',
        outcome_status: 'incomplete',
        reason_code: 'legacy_unknown',
        content: [{ type: 'text', text: 'Old answer' }],
        legacy_provenance: { source: 'pre_final_reply_semantics' },
      }),
    ];
    const projected = projectSessionTimelineMessages({ projectId: 'P1', messages });
    expect((projected[1] as TimelineAssistantMessage).blocks).toContainEqual(expect.objectContaining({
      kind: 'answer_text', status: 'legacy_unknown', text: 'Old answer',
    }));
  });
});

function base(messageId: string) {
  return {
    message_id: messageId,
    session_id: 'S1',
    run_id: 'R1',
    created_at: '2026-07-19T00:00:00.000Z',
    completed_at: '2026-07-19T00:00:00.000Z',
  };
}

function user(messageId: string, text: string): SessionUserMessage {
  return { ...base(messageId), message_kind: 'user_message', content: [{ type: 'text', text }] };
}

function reply(
  messageId: string,
  status: 'completed' | 'failed' | 'cancelled',
  text: string,
): SessionMessage {
  return {
    ...base(messageId),
    message_kind: 'assistant_reply',
    status,
    reason_code: status === 'completed' ? 'normal_completion' : status === 'cancelled' ? 'user_cancelled' : 'internal_error',
    content: text ? [{ type: 'text', text }] : [],
  };
}

function item(message: SessionMessage): SessionMessageWithAttachments {
  return { message, attachments: [] };
}
