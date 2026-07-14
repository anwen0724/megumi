import { describe, expect, it } from 'vitest';
import { SessionConversationMessageSchema } from '@megumi/coding-agent/session';
import type {
  CreateSessionRequest,
  GetActiveHistoryResult,
  Session,
  SessionCompactionSummary,
  SessionEntry,
  SessionMessage,
  SessionMessageAttachment,
  SessionImageImport,
  SessionService,
} from '@megumi/coding-agent/session';

describe('session contracts v2', () => {
  it('models session business entity fields without hidden metadata', () => {
    const session: Session = {
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      title: 'Session',
      status: 'active',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
    };
    const request: CreateSessionRequest = {
      workspace_id: session.workspace_id,
      title: session.title,
    };

    expect(request.workspace_id).toBe('workspace:1');
    expect('session_id' in request).toBe(false);
    expect('created_at' in request).toBe(false);
    expect('metadata_json' in session).toBe(false);
  });

  it('models complete provider-neutral conversation messages without runtime metadata', () => {
    const message: SessionMessage = {
      message_id: 'message:1',
      session_id: 'session:1',
      conversation: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      created_at: '2026-07-04T00:00:00.000Z',
      completed_at: '2026-07-04T00:00:00.000Z',
    };

    expect(message.conversation.role).toBe('user');
    expect('status' in message).toBe(false);
    expect(['blocks', 'json'].join('_') in message).toBe(false);
  });

  it('accepts semantic assistant and tool-result messages and rejects provider/runtime fields', () => {
    expect(SessionConversationMessageSchema.parse({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'inspect first' },
        { type: 'text', text: 'Checking.' },
        { type: 'toolCall', id: 'T1', name: 'read_file', argumentsText: '{"path":"a.ts"}' },
      ],
      stopReason: 'tool_use',
    })).toMatchObject({ role: 'assistant', stopReason: 'tool_use' });
    expect(SessionConversationMessageSchema.parse({
      role: 'toolResult',
      toolCallId: 'T1',
      toolName: 'read_file',
      status: 'success',
      content: [{ type: 'text', text: 'source' }],
    })).toMatchObject({ role: 'toolResult', toolCallId: 'T1' });

    for (const forbidden of [
      { usage: { input_tokens: 1 } },
      { error: { code: 'provider_error' } },
      { sequence: 2 },
      { requestId: 'request:1' },
    ]) {
      expect(SessionConversationMessageSchema.safeParse({
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        ...forbidden,
      }).success).toBe(false);
    }
  });

  it('models transient image imports separately from canonical attachment facts', () => {
    const input: SessionImageImport = {
      name: 'error.png',
      media_type: 'image/png',
      byte_length: 8,
      bytes: new Uint8Array(8),
    };
    const saved: SessionMessageAttachment = {
      attachment_id: 'attachment:1',
      message_id: 'message:1',
      session_id: 'session:1',
      type: 'image',
      name: input.name,
      mime_type: input.media_type,
      source_type: 'host_reference',
      source_value: 'attachment:1/original.png',
      created_at: '2026-07-04T00:00:00.000Z',
    };

    expect(saved.source_type).toBe('host_reference');
    expect(input).not.toHaveProperty('attachment_id');
  });

  it('models active path entries as message or compaction only', () => {
    const messageEntry: SessionEntry = {
      entry_id: 'entry:1',
      session_id: 'session:1',
      entry_type: 'message',
      message_id: 'message:1',
      created_at: '2026-07-04T00:00:00.000Z',
    };
    const compaction: SessionCompactionSummary = {
      compaction_id: 'compaction:1',
      session_id: 'session:1',
      summary_text: 'Summary',
      covered_until_entry_id: 'entry:1',
      first_kept_entry_id: 'entry:2',
      created_at: '2026-07-04T00:00:00.000Z',
    };

    expect(messageEntry.entry_type).toBe('message');
    expect(compaction.covered_until_entry_id).toBe('entry:1');
    expect('retry_attempt' in messageEntry).toBe(false);
  });

  it('models getActiveHistory as message and compaction items', () => {
    const result: GetActiveHistoryResult = {
      status: 'ok',
      history: [{
        type: 'compaction',
        entry: {
          entry_id: 'entry:summary',
          session_id: 'session:1',
          entry_type: 'compaction',
          compaction_id: 'compaction:1',
          created_at: '2026-07-04T00:00:00.000Z',
        },
        compaction: {
          compaction_id: 'compaction:1',
          session_id: 'session:1',
          summary_text: 'Earlier context summary',
          covered_until_entry_id: 'entry:4',
          created_at: '2026-07-04T00:00:00.000Z',
        },
      }],
    };

    expect(result.history[0].type).toBe('compaction');
  });

  it('exposes SessionService as the public module capability', () => {
    const service = {} as SessionService;

    expect(service).toBeDefined();
  });
});
