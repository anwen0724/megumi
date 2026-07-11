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
            attachment_id: 'attachment-image',
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
            attachment_id: 'attachment-file',
            message_id: 'message-user-1',
            session_id: 'session-1',
            type: 'file',
            name: 'trace.json',
            mime_type: 'application/json',
            source_type: 'local_file',
            source_value: 'C:/tmp/trace.json',
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
            { type: 'image', source: { type: 'host_reference', referenceId: 'host-image-1' } },
            {
              type: 'file',
              fileId: 'C:/tmp/trace.json',
              name: 'trace.json',
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

function compactionHistoryItem(): SessionHistoryItem {
  return {
    type: 'compaction',
    entry: {
      entry_id: 'entry-compaction-1',
      session_id: 'session-1',
      entry_type: 'compaction',
      compaction_id: 'compaction-1',
      created_at: '2026-07-11T00:00:00.000Z',
    },
    compaction: {
      compaction_id: 'compaction-1',
      session_id: 'session-1',
      summary_text: 'Earlier work.',
      covered_until_entry_id: 'entry-assistant-0',
      created_at: '2026-07-11T00:00:00.000Z',
    },
  };
}
