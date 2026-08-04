/* Verifies historical Timeline projection from explicit Session variants. */
import { describe, expect, it } from 'vitest';
import {
  createSessionTimelineQuery,
  createRuntimeTimeline,
  reduceRuntimeTimeline,
  type TimelineAssistantMessage,
  type TimelineMessage,
  type TimelineUserMessage,
} from '../../../packages/projections/src/index';
import type { AnyEvent } from '@megumi/events';
import type {
  SessionMessage,
  SessionMessageWithAttachments,
  UserMessage,
} from '@megumi/session';

function projectSessionTimelineMessages(input: {
  projectId: string;
  messages: SessionMessageWithAttachments[];
  isRunLive?: (runId: string) => boolean;
}) {
  const sessionId = input.messages[0]?.message.session_id ?? 'session:unknown';
  const query = createSessionTimelineQuery({
    sessionHistory: {
      getActiveConversationHistory: () => ({ status: 'ok', messages: input.messages }),
    },
    ...(input.isRunLive ? { isRunLive: input.isRunLive } : {}),
  });
  return query.list({ workspaceId: input.projectId, sessionId }).messages;
}

function reduceRuntimeTimelineEvent(
  timeline: TimelineMessage[],
  eventToApply: AnyEvent,
): TimelineMessage[] {
  return reduceRuntimeTimeline({
    timeline: createRuntimeTimeline({ messages: timeline }),
    event: eventToApply,
  }).messages;
}

describe('Session Timeline projection', () => {
  it('projects the persisted Skill selection onto the user message', () => {
    const withSelection = item({
      ...user('U1', 'review this'),
      skill_selection: { name: 'review-code', skill_path: 'C:/skills/review-code/SKILL.md' },
    });
    const withoutSelection = item(user('U2', 'plain task'));

    const projected = projectSessionTimelineMessages({
      projectId: 'P1',
      messages: [withSelection, withoutSelection],
    });
    const userMessages = projected.filter((message) => message.role === 'user');

    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      role: 'user',
      skillSelection: { name: 'review-code', skillPath: 'C:/skills/review-code/SKILL.md' },
    });
    expect(userMessages[1]).not.toHaveProperty('skillSelection');
  });

  it('keeps persisted attachment ordinal and projects each semantic message once', () => {
    const userMessage = item(user('U1', 'inspect attachments'));
    userMessage.attachments = [
      {
        attachment_id: 'attachment:document',
        message_id: 'U1',
        session_id: 'S1',
        type: 'file',
        name: 'second.pdf',
        mime_type: 'application/pdf',
        source_type: 'local_file',
        source_value: 'C:/workspace/second.pdf',
        ordinal: 1,
        created_at: '2026-07-12T00:00:00.000Z',
      },
      {
        attachment_id: 'attachment:image',
        message_id: 'U1',
        session_id: 'S1',
        type: 'image',
        name: 'first.png',
        mime_type: 'image/png',
        source_type: 'local_file',
        source_value: 'attachments/first.png',
        ordinal: 0,
        created_at: '2026-07-12T00:00:00.000Z',
      },
    ];
    const assistantReply = item(reply('A1', 'completed', 'Done.'));

    const projected = projectSessionTimelineMessages({
      projectId: 'P1',
      messages: [userMessage, userMessage, assistantReply, assistantReply],
    });

    expect(projected).toHaveLength(2);
    const projectedUser = projected[0] as TimelineUserMessage;
    expect(projectedUser.blocks
      .filter((block) => block.kind === 'user_attachment')
      .map((block) => block.name)).toEqual(['first.png', 'second.pdf']);
  });

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

  it('keeps the Run disclosure when a completed reply has no process items', () => {
    const startedAt = '2026-07-19T00:00:00.000Z';
    const endedAt = '2026-07-19T00:00:04.000Z';
    const messages = [
      item({ ...user('U1', 'hello'), created_at: startedAt, completed_at: startedAt }),
      item({ ...reply('A1', 'completed', 'Hello!'), created_at: endedAt, completed_at: endedAt }),
    ];

    const projected = projectSessionTimelineMessages({ projectId: 'P1', messages });
    const assistant = projected[1] as TimelineAssistantMessage;

    expect(assistant.blocks).toEqual([
      expect.objectContaining({
        kind: 'process_disclosure',
        status: 'completed',
        startedAt,
        endedAt,
        items: [],
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

  it.each([
    ['success', 'success', 'succeeded'],
    ['failure', 'failure', 'failed'],
    // The live event model has no 'denied' outcome: denials settle as failed.
    ['permission_denied', 'permission_denied', 'failed'],
    ['user_rejected', 'user_rejected', 'failed'],
    ['cancelled', 'cancelled', 'cancelled'],
  ] as const)('projects %s Tool Results to the same live and historical terminal activity', (sessionStatus, eventKind, expectedStatus) => {
    // The live event model carries only message/code on tool errors.
    const error = sessionStatus === 'success'
      ? undefined
      : { code: `${sessionStatus}_code`, message: `${sessionStatus} message` };
    let live = reduceRuntimeTimelineEvent([], runtimeEvent('turn.ended', {
      stopReason: 'tool_calls', messageId: 'M1', toolCallIds: ['T1'],
    }, 1));
    live = reduceRuntimeTimelineEvent(live, runtimeEvent('tool_execution.started', {
      toolCallId: 'T1', toolName: 'web_fetch', args: { url: 'https://example.com' },
    }, 2));
    const endedStatus = eventKind === 'success' ? 'completed' : eventKind === 'cancelled' ? 'cancelled' : 'failed';
    live = reduceRuntimeTimelineEvent(live, runtimeEvent('tool_execution.ended', {
      toolCallId: 'T1',
      status: endedStatus,
      ...(error ? { error } : {}),
    }, 3));
    const liveAssistant = live.find((message) => message.role === 'assistant') as TimelineAssistantMessage;
    const liveProcess = liveAssistant.blocks.find((block) => block.kind === 'process_disclosure');
    const liveTool = liveProcess?.items.find((entry) => entry.kind === 'tool_activity');

    const historical = projectSessionTimelineMessages({
      projectId: 'P1',
      messages: [
        item(user('U1', 'fetch')),
        item({
          ...base('M1'), message_kind: 'model_response', outcome_status: 'completed', stop_reason: 'tool_calls',
          content: [{ type: 'toolCall', id: 'T1', name: 'web_fetch', argumentsText: '{"url":"https://example.com"}' }],
        }),
        item({
          ...base('T1-result'), message_kind: 'tool_result', tool_call_id: 'T1', tool_name: 'web_fetch',
          status: sessionStatus, content: [{ type: 'text', text: error?.message ?? 'success body' }], ...(error ? { error } : {}),
        }),
        item(reply('A1', 'completed', 'Done.')),
      ],
    });
    const historicalAssistant = historical.find((message) => message.role === 'assistant') as TimelineAssistantMessage;
    const historicalProcess = historicalAssistant.blocks.find((block) => block.kind === 'process_disclosure');
    const historicalTool = historicalProcess?.items.find((entry) => entry.kind === 'tool_activity');

    expect(liveTool).toMatchObject({
      kind: 'tool_activity', toolCallId: 'T1', toolName: 'web_fetch', inputSummary: 'https://example.com', status: expectedStatus,
      ...(error ? { error } : {}),
    });
    // The historical projection keeps its own richer status vocabulary
    // (denied), so compare only the shared surface.
    expect(historicalTool).toEqual(expect.objectContaining({
      kind: liveTool?.kind,
      toolCallId: liveTool?.toolCallId,
      toolName: liveTool?.toolName,
      inputSummary: liveTool?.inputSummary,
      ...(liveTool?.resultSummary ? { resultSummary: liveTool.resultSummary } : {}),
      ...(error ? { error: liveTool?.error } : {}),
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

function user(messageId: string, text: string): UserMessage {
  return {
    ...base(messageId),
    message_kind: 'user_message',
    display_content: [{ type: 'text', text }],
    model_content: [{ type: 'text', text }],
  };
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

function runtimeEvent(eventType: AnyEvent['type'], payload: Record<string, unknown>, sequence: number): AnyEvent {
  return {
    id: `event-${sequence}`, type: eventType,
    runId: 'R1', sessionId: 'S1', sequence, createdAt: `2026-07-19T00:00:0${sequence}.000Z`,
    payload,
  } as AnyEvent;
}
