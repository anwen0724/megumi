/*
 * Protects the single Session Entry chain: parent_entry_id advances only on
 * successful commits, ordered tool results keep the model call order, and the
 * committer never publishes Runtime Events.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Observability } from '@megumi/observability';
import type {
  SaveAssistantReplyRequest,
  SaveMessageResult,
  SaveModelResponseRequest,
  SaveToolResultMessageRequest,
  SessionEntry,
  SessionMessage,
} from '@megumi/session';
import {
  createSessionMessageCommitter,
  type SessionToolResultCommit,
} from '@megumi/execution';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';

const userEntry: SessionEntry = {
  entry_id: 'entry:user',
  session_id: 'session:1',
  entry_type: 'message',
  message_id: 'message:user',
  created_at: '2026-07-31T00:00:00.000Z',
};

function createRecordingCommitter(overrides: {
  failModelResponse?: boolean;
  failToolResultAt?: number;
  failAssistantReply?: boolean;
} = {}, observability?: Observability) {
  let toolCalls = 0;
  let modelCalls = 0;
  let replyCalls = 0;
  let messageNumber = 0;
  const savedMessage = (
    request: SaveModelResponseRequest | SaveToolResultMessageRequest | SaveAssistantReplyRequest,
    entryId: string,
  ): SaveMessageResult => ({
    status: 'saved' as const,
    message: {
      message_id: request.message_id,
      session_id: request.session_id,
      execution_id: request.execution_id,
      created_at: request.completed_at,
    } as SessionMessage,
    entry: {
      entry_id: entryId,
      session_id: request.session_id,
      entry_type: 'message' as const,
      message_id: request.message_id,
      created_at: request.completed_at,
    },
  });
  const session = {
    saveModelResponse: vi.fn((request: SaveModelResponseRequest) => (
      overrides.failModelResponse
        ? { status: 'failed' as const, failure: { code: 'session_error', message: 'Model response failed.' } }
        : savedMessage(request, `entry:model:${++modelCalls}`)
    )),
    saveToolResultMessage: vi.fn((request: SaveToolResultMessageRequest) => (
      overrides.failToolResultAt === toolCalls
        ? { status: 'failed' as const, failure: { code: 'session_error', message: 'Tool result failed.' } }
        : savedMessage(request, `entry:tool:${++toolCalls}`)
    )),
    saveAssistantReply: vi.fn((request: SaveAssistantReplyRequest) => (
      overrides.failAssistantReply
        ? { status: 'failed' as const, failure: { code: 'session_error', message: 'Assistant reply failed.' } }
        : savedMessage(request, `entry:reply:${++replyCalls}`)
    )),
  };
  const committer = createSessionMessageCommitter({
    userEntry,
    session,
    ids: { createSessionMessageId: () => `message:${++messageNumber}` },
    ...(observability ? { observability } : {}),
  });
  return { committer, session };
}

function toolResult(overrides: Partial<SessionToolResultCommit> & { callOrder: number; toolCallId: string }): SessionToolResultCommit {
  return {
    toolName: `tool:${overrides.toolCallId}`,
    status: 'success',
    content: `result:${overrides.toolCallId}`,
    completedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('SessionMessageCommitter', () => {
  it('chains parent entries from the User Entry through model, tools and final reply', async () => {
    const { committer, session } = createRecordingCommitter();

    const model = await committer.commitModelResponse({
      sessionId: 'session:1',
      executionId: 'run:1',
      messageId: 'message:model',
      content: [{ type: 'text', text: 'using tools' }],
      stopReason: 'toolUse',
      completedAt: '2026-07-31T00:00:00.001Z',
    });
    expect(model.status).toBe('saved');
    const tool = await committer.commitToolResults({
      sessionId: 'session:1',
      executionId: 'run:1',
      results: [toolResult({ callOrder: 0, toolCallId: 'call:1' })],
    });
    expect(tool.status).toBe('saved');
    const reply = await committer.commitAssistantReply({
      sessionId: 'session:1',
      executionId: 'run:1',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
      reasonCode: 'normal_completion',
      completedAt: '2026-07-31T00:00:00.002Z',
    });
    expect(reply.status).toBe('saved');

    expect(session.saveModelResponse.mock.calls[0]?.[0]).toMatchObject({
      parent_entry_id: 'entry:user',
      message_id: 'message:model',
      outcome_status: 'completed',
    });
    expect(session.saveToolResultMessage.mock.calls[0]?.[0]).toMatchObject({
      parent_entry_id: 'entry:model:1',
    });
    expect(session.saveAssistantReply.mock.calls[0]?.[0]).toMatchObject({
      parent_entry_id: 'entry:tool:1',
      status: 'completed',
      reason_code: 'normal_completion',
    });
  });

  it('commits tool results in the original model call order and returns committed identities', async () => {
    const { committer, session } = createRecordingCommitter();
    const committed = await committer.commitToolResults({
      sessionId: 'session:1',
      executionId: 'run:1',
      results: [
        toolResult({ callOrder: 1, toolCallId: 'call:2' }),
        toolResult({ callOrder: 0, toolCallId: 'call:1' }),
        toolResult({ callOrder: 2, toolCallId: 'call:3' }),
      ],
    });
    expect(committed.status).toBe('saved');
    if (committed.status !== 'saved') return;

    const saved = session.saveToolResultMessage.mock.calls.map(([request]) => request);
    expect(saved.map((request) => request.tool_call_id)).toEqual(['call:1', 'call:2', 'call:3']);
    // Each tool result chains onto the previously committed entry.
    expect(saved[1]?.parent_entry_id).toBe('entry:tool:1');
    expect(saved[2]?.parent_entry_id).toBe('entry:tool:2');
    expect(committed.items.map((item) => item.toolCallId)).toEqual(['call:1', 'call:2', 'call:3']);
    expect(committed.items.map((item) => item.messageId)).toEqual(saved.map((request) => request.message_id));
  });

  it('does not advance the entry chain when a commit fails', async () => {
    const { committer, session } = createRecordingCommitter({ failModelResponse: true });

    const failed = await committer.commitModelResponse({
      sessionId: 'session:1',
      executionId: 'run:1',
      messageId: 'message:model',
      content: [],
      stopReason: 'stop',
      completedAt: '2026-07-31T00:00:00.001Z',
    });
    expect(failed.status).toBe('failed');

    const reply = await committer.commitAssistantReply({
      sessionId: 'session:1',
      executionId: 'run:1',
      status: 'failed',
      content: [],
      completedAt: '2026-07-31T00:00:00.002Z',
    });
    expect(reply.status).toBe('saved');
    // The reply still chains onto the User Entry: nothing after the failed
    // commit advanced the chain.
    expect(session.saveAssistantReply.mock.calls[0]?.[0]).toMatchObject({
      parent_entry_id: 'entry:user',
    });
  });

  it('keeps the partial successes when a later commit fails and stops the batch', async () => {
    const { committer, session } = createRecordingCommitter({ failToolResultAt: 1 });

    const failed = await committer.commitToolResults({
      sessionId: 'session:1',
      executionId: 'run:1',
      results: [
        toolResult({ callOrder: 0, toolCallId: 'call:1' }),
        toolResult({ callOrder: 1, toolCallId: 'call:2' }),
        toolResult({ callOrder: 2, toolCallId: 'call:3' }),
      ],
    });
    expect(failed.status).toBe('failed');
    if (failed.status !== 'failed') return;
    // The first result persisted, the second failed, and the batch stopped
    // there: the third result was never attempted.
    expect(session.saveToolResultMessage).toHaveBeenCalledTimes(2);
    // The really saved item is still reported; the chain stayed on its Entry.
    expect(failed.items).toEqual([
      expect.objectContaining({ toolCallId: 'call:1', messageId: 'message:1' }),
    ]);
  });

  it('creates and reuses assistant message identities as requested by the loop', async () => {
    const { committer, session } = createRecordingCommitter();

    await committer.commitAssistantReply({
      sessionId: 'session:1',
      executionId: 'run:1',
      status: 'cancelled',
      content: [],
      completedAt: '2026-07-31T00:00:00.001Z',
    });
    // No streaming identity: the committer creates one.
    expect(session.saveAssistantReply.mock.calls[0]?.[0]).toMatchObject({
      message_id: 'message:1',
      status: 'cancelled',
    });
    await committer.commitAssistantReply({
      sessionId: 'session:1',
      executionId: 'run:1',
      status: 'completed',
      content: [],
      messageId: 'message:streamed',
      completedAt: '2026-07-31T00:00:00.002Z',
    });
    expect(session.saveAssistantReply.mock.calls[1]?.[0]).toMatchObject({
      message_id: 'message:streamed',
      status: 'completed',
    });
  });

  it('never publishes runtime events: commits only reach the Session stub', async () => {
    const { committer, session } = createRecordingCommitter();
    await committer.commitModelResponse({
      sessionId: 'session:1',
      executionId: 'run:1',
      messageId: 'message:model',
      content: [],
      stopReason: 'stop',
      completedAt: '2026-07-31T00:00:00.001Z',
    });
    // No events bus is involved: the committer's only collaborator is Session.
    expect(session.saveModelResponse).toHaveBeenCalledTimes(1);
  });

  it('records each real Session save as a commit span with identity and digest only', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: (record) => { records.push(record); } });
    const { committer } = createRecordingCommitter({}, observability);

    await observability.withTrace({ kind: 'conversation' }, async () => {
      await committer.commitModelResponse({
        sessionId: 'session:1',
        executionId: 'run:1',
        messageId: 'message:model',
        content: [{ type: 'text', text: 'using tools' }],
        stopReason: 'toolUse',
        completedAt: '2026-07-31T00:00:00.001Z',
      });
      await committer.commitToolResults({
        sessionId: 'session:1',
        executionId: 'run:1',
        results: [toolResult({ callOrder: 0, toolCallId: 'call:1' })],
      });
      await committer.commitAssistantReply({
        sessionId: 'session:1',
        executionId: 'run:1',
        status: 'completed',
        content: [{ type: 'text', text: 'done' }],
        completedAt: '2026-07-31T00:00:00.002Z',
      });
    });

    const started = records.filter((record) => record.type === 'span.started');
    expect(started).toHaveLength(3);
    expect(started.map((record) => record.name)).toEqual([
      'session.message.commit',
      'session.message.commit',
      'session.message.commit',
    ]);
    expect(started.map((record) => record.correlation.messageId)).toEqual([
      'message:model',
      'message:1',
      'message:2',
    ]);
    expect(started.every((record) => /^[a-f0-9]{64}$/.test(record.correlation.contentDigest ?? ''))).toBe(true);
    expect(records.some((record) => record.type === 'content.recorded')).toBe(false);
    expect(records.filter((record) => record.type === 'span.ended').every((record) => (
      record.outcome.status === 'ok' && record.outcome.code === 'saved'
    ))).toBe(true);
  });

  it('keeps a Session save single-shot when the diagnostic wrapper throws before invoking it', async () => {
    const observability: Observability = {
      withTrace: (_options, operation) => operation(),
      withSpan: async () => { throw new Error('diagnostics unavailable'); },
      recordContent: () => undefined,
      recordEvent: () => undefined,
      linkTrace: () => undefined,
    };
    const { committer, session } = createRecordingCommitter({}, observability);

    const result = await committer.commitAssistantReply({
      sessionId: 'session:1',
      executionId: 'run:1',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
      completedAt: '2026-07-31T00:00:00.002Z',
    });

    expect(result.status).toBe('saved');
    expect(session.saveAssistantReply).toHaveBeenCalledTimes(1);
  });
});
