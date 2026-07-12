/*
 * Verifies projection of Session-owned history and Agent Run transcripts into complete turns.
 */
import { describe, expect, it } from 'vitest';
import type { RunModelTranscript } from '@megumi/coding-agent/agent-run';
import type { SessionHistoryItem } from '@megumi/coding-agent/session';
import { buildConversationTurns } from '@megumi/coding-agent/context/service/internal/conversation-turn-builder';

describe('buildConversationTurns', () => {
  it('combines each completed Session pair with its transcript and preserves attachments', () => {
    const history: SessionHistoryItem[] = [
      compactionHistoryItem(),
      messageHistoryItem({
        entryId: 'entry-user-1',
        messageId: 'message-user-1',
        runId: 'run-1',
        role: 'user',
        content: 'Inspect this input.',
        attachments: [
          {
            attachment_id: 'attachment-image-local',
            message_id: 'message-user-1',
            session_id: 'session-1',
            type: 'image',
            name: 'local-screen.png',
            mime_type: 'image/png',
            source_type: 'local_file',
            source_value: 'C:/tmp/local-screen.png',
            created_at: '2026-07-11T00:00:00.000Z',
          },
          {
            attachment_id: 'attachment-image-host',
            message_id: 'message-user-1',
            session_id: 'session-1',
            type: 'image',
            name: 'screen.png',
            mime_type: 'image/png',
            source_type: 'host_reference',
            source_value: 'host-image-1',
            created_at: '2026-07-11T00:00:00.000Z',
          },
          {
            attachment_id: 'attachment-file-local',
            message_id: 'message-user-1',
            session_id: 'session-1',
            type: 'file',
            name: 'trace.json',
            mime_type: 'application/json',
            source_type: 'local_file',
            source_value: 'C:/tmp/trace.json',
            created_at: '2026-07-11T00:00:00.000Z',
          },
          {
            attachment_id: 'attachment-file-host',
            message_id: 'message-user-1',
            session_id: 'session-1',
            type: 'file',
            name: 'host-trace.json',
            mime_type: 'application/json',
            source_type: 'host_reference',
            source_value: 'host-file-1',
            created_at: '2026-07-11T00:00:00.000Z',
          },
        ],
      }),
      messageHistoryItem({
        entryId: 'entry-assistant-1',
        messageId: 'message-assistant-1',
        runId: 'run-1',
        role: 'assistant',
        content: 'Inspection complete.',
      }),
    ];
    const transcriptsByRunId = new Map<string, RunModelTranscript>([[
      'run-1',
      {
        runId: 'run-1',
        items: [
          { type: 'assistant_message', content: [{ type: 'text', text: 'I will inspect it.' }] },
          {
            type: 'tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'inspect',
            arguments: { path: 'C:/tmp/trace.json' },
          },
          {
            type: 'tool_result',
            toolCallId: 'tool-call-1',
            toolName: 'inspect',
            status: 'success',
            content: [{ type: 'json', value: { valid: true } }],
          },
        ],
      },
    ]]);

    const result = buildConversationTurns({ history, transcriptsByRunId });

    expect(result).toEqual({
      status: 'built',
      turns: [{
        source: {
          runId: 'run-1',
          userEntryId: 'entry-user-1',
          userMessageId: 'message-user-1',
          assistantEntryId: 'entry-assistant-1',
          assistantMessageId: 'message-assistant-1',
        },
        userMessage: {
          type: 'user_message',
          content: [
            { type: 'text', text: 'Inspect this input.' },
            { type: 'image', source: { type: 'local_file', path: 'C:/tmp/local-screen.png' } },
            { type: 'image', source: { type: 'host_reference', referenceId: 'host-image-1' } },
            {
              type: 'file',
              fileId: 'attachment-file-local',
              name: 'trace.json',
              mediaType: 'application/json',
            },
            {
              type: 'file',
              fileId: 'attachment-file-host',
              name: 'host-trace.json',
              mediaType: 'application/json',
            },
          ],
        },
        responseItems: [
          { type: 'assistant_message', content: [{ type: 'text', text: 'I will inspect it.' }] },
          {
            type: 'tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'inspect',
            arguments: { path: 'C:/tmp/trace.json' },
          },
          {
            type: 'tool_result',
            toolCallId: 'tool-call-1',
            toolName: 'inspect',
            status: 'success',
            content: [{ type: 'json', value: { valid: true } }],
          },
          { type: 'assistant_message', content: [{ type: 'text', text: 'Inspection complete.' }] },
        ],
      }],
    });
  });

  it('fails when a completed historical run has no usable transcript', () => {
    const history: SessionHistoryItem[] = [
      messageHistoryItem({
        entryId: 'entry-user-1',
        messageId: 'message-user-1',
        runId: 'run-1',
        role: 'user',
        content: 'Hello',
      }),
      messageHistoryItem({
        entryId: 'entry-assistant-1',
        messageId: 'message-assistant-1',
        runId: 'run-1',
        role: 'assistant',
        content: 'Hello back',
      }),
    ];

    expect(buildConversationTurns({ history, transcriptsByRunId: new Map() })).toEqual({
      status: 'failed',
      failure: {
        code: 'missing_historical_transcript',
        runId: 'run-1',
        message: 'Completed historical run run-1 has no usable transcript.',
      },
    });
  });

  it('excludes covered turns when effective compaction is the final history item', () => {
    const history = [
      ...completedRunHistory('covered'),
      compactionHistoryItem('effective'),
    ];

    expect(buildConversationTurns({ history, transcriptsByRunId: new Map() })).toEqual({
      status: 'built',
      turns: [],
    });
  });

  it('builds only retained turns after the effective compaction boundary', () => {
    const history = [
      ...completedRunHistory('covered'),
      compactionHistoryItem('effective'),
      ...completedRunHistory('retained'),
    ];

    const result = buildConversationTurns({
      history,
      transcriptsByRunId: new Map([['retained', emptyTranscript('retained')]]),
    });

    expect(result.status).toBe('built');
    if (result.status !== 'built') throw new Error('Expected retained history to build.');
    expect(result.turns.map((turn) => turn.source.runId)).toEqual(['retained']);
  });

  it('uses the last compaction item as the effective boundary', () => {
    const history = [
      ...completedRunHistory('covered-first'),
      compactionHistoryItem('first'),
      ...completedRunHistory('covered-second'),
      compactionHistoryItem('effective'),
      ...completedRunHistory('retained'),
    ];

    const result = buildConversationTurns({
      history,
      transcriptsByRunId: new Map([['retained', emptyTranscript('retained')]]),
    });

    expect(result.status).toBe('built');
    if (result.status !== 'built') throw new Error('Expected retained history to build.');
    expect(result.turns.map((turn) => turn.source.runId)).toEqual(['retained']);
  });

  it('builds multiple completed runs in Session history order', () => {
    const history = [
      ...completedRunHistory('run-1'),
      ...completedRunHistory('run-2'),
    ];
    const result = buildConversationTurns({
      history,
      transcriptsByRunId: new Map([
        ['run-1', emptyTranscript('run-1')],
        ['run-2', emptyTranscript('run-2')],
      ]),
    });

    expect(result.status).toBe('built');
    if (result.status !== 'built') throw new Error('Expected multiple history turns to build.');
    expect(result.turns.map((turn) => turn.source.runId)).toEqual(['run-1', 'run-2']);
  });

  it('fails without emitting a partial turn for an incomplete User and Assistant pair', () => {
    const history = [messageHistoryItem({
      entryId: 'entry-user-incomplete',
      messageId: 'message-user-incomplete',
      runId: 'run-incomplete',
      role: 'user',
      content: 'Incomplete',
    })];

    expect(buildConversationTurns({ history, transcriptsByRunId: new Map() })).toEqual({
      status: 'failed',
      failure: {
        code: 'invalid_historical_turn',
        runId: 'run-incomplete',
        message: 'Historical run run-incomplete is missing its final Assistant Message.',
      },
    });
  });

  it('rejects a transcript whose canonical runId does not match the Session run', () => {
    expect(buildConversationTurns({
      history: completedRunHistory('run-session'),
      transcriptsByRunId: new Map([['run-session', emptyTranscript('run-other')]]),
    })).toEqual({
      status: 'failed',
      failure: {
        code: 'missing_historical_transcript',
        runId: 'run-session',
        message: 'Completed historical run run-session has no usable transcript.',
      },
    });
  });

  it('preserves the canonical transcript tool protocol order without re-validating it', () => {
    const items: RunModelTranscript['items'] = [
      { type: 'assistant_message', content: [{ type: 'text', text: 'Calling two tools.' }] },
      { type: 'tool_call', toolCallId: 'call-a', toolName: 'lookup', arguments: { id: 'a' } },
      { type: 'tool_call', toolCallId: 'call-b', toolName: 'lookup', arguments: { id: 'b' } },
      {
        type: 'tool_result',
        toolCallId: 'call-b',
        toolName: 'lookup',
        status: 'success',
        content: [{ type: 'text', text: 'B' }],
      },
      {
        type: 'tool_result',
        toolCallId: 'call-a',
        toolName: 'lookup',
        status: 'failure',
        content: [{ type: 'text', text: 'A failed' }],
      },
    ];
    const result = buildConversationTurns({
      history: completedRunHistory('run-tools'),
      transcriptsByRunId: new Map([['run-tools', { runId: 'run-tools', items }]]),
    });

    expect(result.status).toBe('built');
    if (result.status !== 'built') throw new Error('Expected tool transcript to build.');
    expect(result.turns[0].responseItems.slice(0, -1)).toEqual(items);
  });
});

function messageHistoryItem(input: {
  entryId: string;
  messageId: string;
  runId: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Extract<SessionHistoryItem, { type: 'message' }>['attachments'];
}): SessionHistoryItem {
  return {
    type: 'message',
    entry: {
      entry_id: input.entryId,
      session_id: 'session-1',
      entry_type: 'message',
      message_id: input.messageId,
      created_at: '2026-07-11T00:00:00.000Z',
    },
    message: {
      message_id: input.messageId,
      session_id: 'session-1',
      run_id: input.runId,
      role: input.role,
      content_text: input.content,
      created_at: '2026-07-11T00:00:00.000Z',
      completed_at: input.role === 'assistant' ? '2026-07-11T00:00:01.000Z' : undefined,
    },
    attachments: input.attachments ?? [],
  };
}

function completedRunHistory(runId: string): SessionHistoryItem[] {
  return [
    messageHistoryItem({
      entryId: `entry-user-${runId}`,
      messageId: `message-user-${runId}`,
      runId,
      role: 'user',
      content: `User ${runId}`,
    }),
    messageHistoryItem({
      entryId: `entry-assistant-${runId}`,
      messageId: `message-assistant-${runId}`,
      runId,
      role: 'assistant',
      content: `Assistant ${runId}`,
    }),
  ];
}

function emptyTranscript(runId: string): RunModelTranscript {
  return { runId, items: [] };
}

function compactionHistoryItem(compactionId = 'compaction-1'): SessionHistoryItem {
  return {
    type: 'compaction',
    entry: {
      entry_id: `entry-compaction-${compactionId}`,
      session_id: 'session-1',
      entry_type: 'compaction',
      compaction_id: compactionId,
      created_at: '2026-07-11T00:00:00.000Z',
    },
    compaction: {
      compaction_id: compactionId,
      session_id: 'session-1',
      summary_text: 'Earlier work.',
      covered_until_entry_id: 'entry-assistant-0',
      created_at: '2026-07-11T00:00:00.000Z',
    },
  };
}
