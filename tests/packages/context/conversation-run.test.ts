/* Protects Session variant grouping and interrupted Tool Call repair. */
import type { SessionHistoryItem, SessionMessage } from '@megumi/session';
import { describe, expect, it } from 'vitest';
import { buildConversationRuns } from '../../../packages/context/src/conversation-run';

describe('buildConversationRuns', () => {
  it('groups semantic Session messages and derives a cancelled result for an interrupted Tool Call', () => {
    const history: SessionHistoryItem[] = [
      {
        type: 'message',
        entry: {
          entry_id: 'entry:user',
          session_id: 'session:1',
          entry_type: 'message',
          message_id: 'message:user',
          created_at: 'now',
        },
        message: {
          message_id: 'message:user',
          session_id: 'session:1',
          run_id: 'run:1',
          message_kind: 'user_message',
          display_content: [{ type: 'text', text: 'question' }],
          model_content: [{ type: 'text', text: 'question' }],
          created_at: 'now',
        },
        attachments: [{
          attachment_id: 'attachment:image',
          message_id: 'message:user',
          session_id: 'session:1',
          type: 'image',
          source_type: 'host_reference',
          source_value: 'stored/image.png',
          ordinal: 0,
          created_at: 'now',
        }],
      },
      {
        type: 'message',
        entry: {
          entry_id: 'entry:model',
          session_id: 'session:1',
          parent_entry_id: 'entry:user',
          entry_type: 'message',
          message_id: 'message:model',
          created_at: 'now',
        },
        message: {
          message_id: 'message:model',
          session_id: 'session:1',
          run_id: 'run:1',
          message_kind: 'model_response',
          content: [
            { type: 'text', text: 'checking' },
            { type: 'toolCall', id: 'call:1', name: 'read_file', argumentsText: '{"path":"a"}' },
          ],
          outcome_status: 'incomplete',
          created_at: 'now',
          completed_at: 'now',
        },
        attachments: [],
      },
    ];

    expect(buildConversationRuns(history)).toEqual([expect.objectContaining({
      source: expect.objectContaining({ runId: 'run:1', lastEntryId: 'entry:model' }),
      userMessage: {
        type: 'user_message',
        content: [
          { type: 'text', text: 'question' },
          { type: 'image', source: { type: 'host_reference', referenceId: 'attachment:image' } },
        ],
      },
      items: [
        { type: 'assistant_message', content: [{ type: 'text', text: 'checking' }] },
        { type: 'tool_call', toolCallId: 'call:1', toolName: 'read_file', arguments: { path: 'a' } },
        expect.objectContaining({
          type: 'tool_result',
          toolCallId: 'call:1',
          status: 'cancelled',
          error: { code: 'runtime_interrupted', message: expect.any(String) },
        }),
      ],
    })]);
  });

  it('uses only history after the effective rolling Summary', () => {
    const history: SessionHistoryItem[] = [{
      type: 'compaction',
      entry: {
        entry_id: 'entry:summary',
        session_id: 'session:1',
        entry_type: 'compaction',
        compaction_id: 'compaction:1',
        created_at: 'now',
      },
      compaction: {
        compaction_id: 'compaction:1',
        session_id: 'session:1',
        summary_text: 'summary',
        covered_until_entry_id: 'entry:old',
        created_at: 'now',
      },
    }];
    expect(buildConversationRuns(history)).toEqual([]);
  });

  it('preserves Model Response, Tool Result, and final Assistant Reply as distinct facts', () => {
    const runs = buildConversationRuns([
      message('entry:user', user('message:user', 'run:1', 'read it')),
      message('entry:model', {
        ...base('message:model', 'run:1'),
        message_kind: 'model_response',
        outcome_status: 'completed',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'thinking', thinking: 'Need the file contents.' },
          { type: 'toolCall', id: 'call:1', name: 'read_file', argumentsText: '{"path":"README.md"}' },
        ],
      }),
      message('entry:result', {
        ...base('message:result', 'run:1'),
        message_kind: 'tool_result',
        tool_call_id: 'call:1',
        tool_name: 'read_file',
        status: 'success',
        content: text('content'),
      }),
      message('entry:reply', reply('message:reply', 'run:1', 'completed', 'done')),
      message('entry:user:2', user('message:user:2', 'run:2', 'old request')),
    ]);

    expect(runs[0]).toMatchObject({
      source: { userEntryId: 'entry:user', lastEntryId: 'entry:reply' },
      items: [
        {
          type: 'assistant_message',
          content: [
            { type: 'text', text: 'checking' },
            { type: 'thinking', thinking: 'Need the file contents.' },
          ],
        },
        { type: 'tool_call', toolCallId: 'call:1', arguments: { path: 'README.md' } },
        { type: 'tool_result', toolCallId: 'call:1', status: 'success', content: text('content') },
        { type: 'assistant_message', content: text('done') },
      ],
    });
    expect(runs[1]!.items).toEqual([]);
  });

  it('restores a historical document attachment as its original local path and ordinal', () => {
    const userHistory = message('entry:user', user('message:user', 'run:1', 'read it'));
    userHistory.attachments = [{
      attachment_id: 'attachment:1',
      message_id: 'message:user',
      session_id: 'session:1',
      type: 'file',
      name: 'notes.pdf',
      mime_type: 'application/pdf',
      source_type: 'local_file',
      source_value: 'C:/materials/notes.pdf',
      ordinal: 0,
      created_at: 'now',
    }];
    expect(buildConversationRuns([userHistory])[0]!.userMessage.content).toEqual([
      { type: 'text', text: 'read it' },
      {
        type: 'file',
        path: 'C:/materials/notes.pdf',
        name: 'notes.pdf',
        mediaType: 'application/pdf',
      },
    ]);
  });
});

function base(messageId: string, runId: string) {
  return {
    message_id: messageId,
    session_id: 'session:1',
    run_id: runId,
    created_at: 'now',
    completed_at: 'now',
  };
}

function user(messageId: string, runId: string, value: string): SessionMessage {
  return {
    ...base(messageId, runId),
    message_kind: 'user_message',
    display_content: text(value),
    model_content: text(value),
  };
}

function reply(
  messageId: string,
  runId: string,
  status: 'completed' | 'cancelled',
  value: string,
): SessionMessage {
  return {
    ...base(messageId, runId),
    message_kind: 'assistant_reply',
    status,
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
    entry: {
      entry_id: entryId,
      session_id: 'session:1',
      entry_type: 'message',
      message_id: value.message_id,
      created_at: 'now',
    },
    message: value,
    attachments: [],
  };
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }];
}
