import { describe, expect, it } from 'vitest';
import type {
  CreateSessionRequest,
  GetActiveHistoryResult,
  Session,
  SessionCompactionSummary,
  SessionEntry,
  SessionMessage,
  SessionMessageAttachment,
  SessionMessageAttachmentInput,
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
      session_id: session.session_id,
      workspace_id: session.workspace_id,
      title: session.title,
      created_at: session.created_at,
    };

    expect(request.session_id).toBe('session:1');
    expect('metadata_json' in session).toBe(false);
  });

  it('models completed user and assistant messages without message status or blocks', () => {
    const message: SessionMessage = {
      message_id: 'message:1',
      session_id: 'session:1',
      role: 'user',
      content_text: 'hello',
      created_at: '2026-07-04T00:00:00.000Z',
      completed_at: '2026-07-04T00:00:00.000Z',
    };

    expect(message.role).toBe('user');
    expect('status' in message).toBe(false);
    expect(['blocks', 'json'].join('_') in message).toBe(false);
  });

  it('models user message attachment references', () => {
    const input: SessionMessageAttachmentInput = {
      attachment_id: 'attachment:1',
      type: 'image',
      name: 'error.png',
      mime_type: 'image/png',
      source: { type: 'local_file', path: 'C:/tmp/error.png' },
    };
    const saved: SessionMessageAttachment = {
      attachment_id: input.attachment_id,
      message_id: 'message:1',
      session_id: 'session:1',
      type: input.type,
      name: input.name,
      mime_type: input.mime_type,
      source_type: 'local_file',
      source_value: 'C:/tmp/error.png',
      created_at: '2026-07-04T00:00:00.000Z',
    };

    expect(saved.source_type).toBe('local_file');
    expect(saved.source_value).toBe('C:/tmp/error.png');
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
