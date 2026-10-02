/* Verifies committed conversation history using real Session storage. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/application/storage/index';
import { createSessionHistory } from '@megumi/agent-runtime/sessions/index';
import { createSessionStore } from '@megumi/application/storage/session-store';
import { createSessionMessageCommitter, type SessionToolResultCommit } from '@megumi/agent-runtime/runs/index';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import { createSessionFixture, savedAt } from '../session/session-test-fixture';

const fixtures: Awaited<ReturnType<typeof createSessionFixture>>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

/** Starts a committed user turn without replacing the Session writer. */
async function fixture() {
  const storage = await createSessionFixture();
  fixtures.push(storage);
  const { history, sessionId } = storage;
  const user = await history.saveUserMessage({
    session_id: sessionId, message_id: 'user', execution_id: 'execution',
    display_content: [{ type: 'text', text: 'Find an answer' }],
    model_content: [{ type: 'text', text: 'Find an answer' }], created_at: savedAt,
  });
  if (user.status !== 'saved') throw new Error('User message was not saved');
  let id = 0;
  const options = { userEntry: user.entry, session: history, ids: { createSessionMessageId: () => `saved-${++id}` } };
  return { ...storage, options, committer: createSessionMessageCommitter(options) };
}

function toolResult(callOrder: number, toolCallId: string): SessionToolResultCommit {
  return { callOrder, toolCallId, toolName: 'lookup', status: 'success', content: toolCallId, completedAt: savedAt };
}

function reply(sessionId: string) {
  return { sessionId, executionId: 'execution', status: 'completed' as const,
    content: [{ type: 'text' as const, text: 'Answer' }], completedAt: savedAt };
}

describe('Session message settlement', () => {
  it('reopens a complete conversation with tool results in model call order', async () => {
    const { committer, sessionId, database, filename } = await fixture();
    expect(await committer.commitModelResponse({
      sessionId, executionId: 'execution', messageId: 'model',
      content: [{ type: 'text', text: 'Using tools' }], stopReason: 'toolUse', completedAt: savedAt,
    })).toMatchObject({ status: 'saved' });
    expect(await committer.commitToolResults({
      sessionId, executionId: 'execution', results: [toolResult(1, 'second'), toolResult(0, 'first')],
    })).toMatchObject({ status: 'saved', items: [{ toolCallId: 'first' }, { toolCallId: 'second' }] });
    expect(await committer.commitAssistantReply(reply(sessionId))).toMatchObject({ status: 'saved' });
    database.close();
    const reopened = createDatabase({ filename });
    try {
      const history = createSessionHistory({ store: createSessionStore({ database: reopened }) });
      expect(history.getActiveHistory({ session_id: sessionId })).toMatchObject({ status: 'ok', history: [
        { message: { message_kind: 'user_message' } },
        { message: { message_kind: 'model_response' } },
        { message: { message_kind: 'tool_result', tool_call_id: 'first' } },
        { message: { message_kind: 'tool_result', tool_call_id: 'second' } },
        { message: { message_kind: 'assistant_reply', content: [{ type: 'text', text: 'Answer' }] } },
      ] });
    } finally { reopened.close(); }
  });

  it('keeps the conversation connected after a failed model-response write', async () => {
    const { committer, database, history, sessionId } = await fixture();
    database.prepare({ sql: `CREATE TRIGGER fail_model BEFORE INSERT ON session_messages
      WHEN NEW.message_kind = 'model_response' BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;` }).run();
    expect(await committer.commitModelResponse({ sessionId, executionId: 'execution', messageId: 'model',
      content: [], stopReason: 'stop', completedAt: savedAt })).toMatchObject({ status: 'failed' });
    expect(await committer.commitAssistantReply(reply(sessionId))).toMatchObject({ status: 'saved' });
    expect(history.getActiveHistory({ session_id: sessionId })).toMatchObject({ status: 'ok', history: [
      { message: { message_kind: 'user_message' } }, { message: { message_kind: 'assistant_reply' } },
    ] });
  });

  it('preserves earlier tool results and stops the batch when a later write fails', async () => {
    const { committer, database, history, sessionId } = await fixture();
    database.prepare({ sql: `CREATE TRIGGER fail_tool BEFORE INSERT ON session_messages
      WHEN json_extract(NEW.message_json, '$.tool_call_id') = 'second'
      BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;` }).run();
    expect(await committer.commitToolResults({ sessionId, executionId: 'execution',
      results: [toolResult(0, 'first'), toolResult(1, 'second'), toolResult(2, 'third')],
    })).toMatchObject({ status: 'failed', items: [{ toolCallId: 'first' }] });
    expect(await committer.commitAssistantReply(reply(sessionId))).toMatchObject({ status: 'saved' });
    expect(history.getActiveHistory({ session_id: sessionId })).toMatchObject({ status: 'ok', history: [
      { message: { message_kind: 'user_message' } },
      { message: { message_kind: 'tool_result', tool_call_id: 'first' } },
      { message: { message_kind: 'assistant_reply' } },
    ] });
    expect(history.listMessages({ session_id: sessionId })).toMatchObject({ status: 'ok', messages: [
      expect.any(Object), expect.any(Object), expect.any(Object),
    ] });
  });

  it('retains a streamed reply identity and generates an identity when none was supplied', async () => {
    const { committer, sessionId, history } = await fixture();
    const generated = await committer.commitAssistantReply({ ...reply(sessionId), executionId: 'cancelled', status: 'cancelled' });
    expect(generated).toMatchObject({ status: 'saved', messageId: expect.any(String) });
    expect(await committer.commitAssistantReply({ ...reply(sessionId), messageId: 'streamed-reply' }))
      .toMatchObject({ status: 'saved', messageId: 'streamed-reply' });
    expect(history.getActiveHistory({ session_id: sessionId })).toMatchObject({ status: 'ok', history: [
      { message: { message_kind: 'user_message' } },
      { message: { message_kind: 'assistant_reply', status: 'cancelled' } },
      { message: { message_id: 'streamed-reply', status: 'completed' } },
    ] });
  });

  it('still commits exactly one reply when the diagnostic storage fails', async () => {
    const { options, sessionId, history } = await fixture();
    const observability = createTraceRecorder({ enqueue: () => { throw new Error('trace storage unavailable'); } });
    const committer = createSessionMessageCommitter({ ...options, observability });
    expect(await observability.withTrace({ kind: 'conversation' }, () => committer.commitAssistantReply(reply(sessionId))))
      .toMatchObject({ status: 'saved' });
    const saved = history.listMessages({ session_id: sessionId });
    if (saved.status !== 'ok') throw new Error('Committed messages could not be read');
    expect(saved.messages.filter(item => item.message.message_kind === 'assistant_reply'))
      .toMatchObject([{ message: { content: [{ type: 'text', text: 'Answer' }] } }]);
  });
});
