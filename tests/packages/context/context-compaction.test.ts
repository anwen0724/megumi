/* Exercises Context compaction against real Session, Instructions and Skills storage. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createContext, type CreateContextOptions } from '@megumi/agent-runtime/context/index';
import { sessionMessageText } from '@megumi/agent-runtime/sessions/index';
import { type AnyEvent } from '@megumi/agent-runtime/events';
import { createSessionFixture, savedAt } from '../session/session-test-fixture';
import { completedMessage } from './context-test-fixtures';
import { createContextFixture, contextModel as compactingModel } from './context-behavior-fixture';

const fixtures: Awaited<ReturnType<typeof createSessionFixture>>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

/** Uses a scripted model only at the external model boundary; history is never fabricated. */
async function fixture(completeSimple: CreateContextOptions['models']['completeSimple'] = async () => completedMessage('Earlier conversation summary')) {
  const storage = await createContextFixture(completeSimple);
  fixtures.push(storage);
  const { history, sessionId, options } = storage;
  /** Commits ordinary turns using the same Session API as production callers. */
  async function addTurns(targetSession = sessionId, first = 1, last = 5) {
    for (let turn = first; turn <= last; turn++) {
      const question = `question ${turn}: ${'detail '.repeat(1000)}`;
      const answer = `answer ${turn}: ${'detail '.repeat(1000)}`;
      const user = await history.saveUserMessage({ session_id: targetSession,
        message_id: `${targetSession}:user:${turn}`, execution_id: `execution:${turn}`,
        display_content: [{ type: 'text', text: question }], model_content: [{ type: 'text', text: question }], created_at: savedAt });
      if (user.status !== 'saved') throw new Error('Test user turn was not saved');
      const reply = history.saveAssistantReply({ session_id: targetSession,
        message_id: `${targetSession}:reply:${turn}`, execution_id: `execution:${turn}`,
        status: 'completed', content: [{ type: 'text', text: answer }], completed_at: savedAt });
      if (reply.status !== 'saved') throw new Error('Test assistant turn was not saved');
    }
  }
  await addTurns();
  return { ...storage, addTurns, context: createContext(options) };
}

function activeHistory(storage: Awaited<ReturnType<typeof fixture>>, sessionId = storage.sessionId) {
  const result = storage.history.getActiveHistory({ session_id: sessionId });
  if (result.status !== 'ok') throw new Error('Committed history is unavailable');
  return result.history;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('Context compaction', () => {
  it.each(['manual', 'overflow', 'threshold'] as const)('preserves recent turns and rebuilds from the saved summary for %s', async (trigger) => {
    const f = await fixture();
    if (trigger === 'threshold') expect(await f.context.build(f.buildRequest)).toMatchObject({ status: 'ready' });
    else expect(await f.context.compact({ ...f.request, trigger })).toMatchObject({ status: 'compacted' });
    const history = activeHistory(f);
    expect(history.map(item => item.type)).toEqual(['compaction', 'message', 'message', 'message', 'message']);
    expect(history[0]).toMatchObject({ compaction: { summary_text: 'Earlier conversation summary' } });
    const keptText = history.flatMap(item => item.type === 'message' ? [sessionMessageText(item.message)] : []);
    expect(keptText.map(text => text.split(':')[0])).toEqual(['question 4', 'answer 4', 'question 5', 'answer 5']);
    const rebuilt = await createContext(f.options).build(f.buildRequest);
    expect(rebuilt.status).toBe('ready');
    if (rebuilt.status !== 'ready') throw new Error('Context was not rebuilt');
    expect(JSON.stringify(rebuilt.prompt.messages)).toContain('Earlier conversation summary');
    expect(JSON.stringify(rebuilt.prompt.messages)).toContain('answer 5:');
    expect(JSON.stringify(rebuilt.prompt.messages)).not.toContain('question 1:');
  });

  it('publishes lifecycle events only after their saved state is readable', async () => {
    const f = await fixture();
    const published: Array<{ event: AnyEvent; statuses: string[] }> = [];
    f.events.subscribe({}, event => {
      const conversation = f.history.getActiveConversationHistory({ session_id: f.sessionId });
      if (conversation.status !== 'ok') throw new Error('Conversation unavailable during event');
      published.push({ event, statuses: conversation.conversation.flatMap(item => item.type === 'compaction' ? [item.status] : []) });
    });
    expect(await f.context.compact(f.request)).toMatchObject({ status: 'compacted' });
    expect(published.map(item => ({ type: item.event.type, statuses: item.statuses }))).toEqual([
      { type: 'session.compaction.started', statuses: ['running'] },
      { type: 'session.compaction.ended', statuses: ['completed'] },
    ]);
  });

  it('preserves history and records a failed compaction when the summary provider fails', async () => {
    const f = await fixture(async () => { throw new Error('Provider unavailable'); });
    const before = activeHistory(f);
    expect(await f.context.compact(f.request)).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(activeHistory(f)).toEqual(before);
    expect(f.history.getActiveConversationHistory({ session_id: f.sessionId })).toMatchObject({ status: 'ok',
      conversation: expect.arrayContaining([expect.objectContaining({ type: 'compaction', status: 'failed' })]) });
  });

  it('leaves history unchanged when cancellation was requested before compaction', async () => {
    const f = await fixture(async () => { throw new Error('A cancelled operation must not contact the provider'); });
    const before = f.history.getActiveConversationHistory({ session_id: f.sessionId });
    const controller = new AbortController(); controller.abort();
    expect(await f.context.compact({ ...f.request, signal: controller.signal }))
      .toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(f.history.getActiveConversationHistory({ session_id: f.sessionId })).toEqual(before);
  });

  it('returns nothing to compact when every remaining turn is protected', async () => {
    const f = await fixture();
    const context = createContext({ ...f.options, policy: { ...f.options.policy, minimumRecentMessages: 100 } });
    const before = activeHistory(f);
    expect(await context.compact(f.request)).toEqual({ status: 'nothing_to_compact', reason: 'no_older_messages' });
    expect(activeHistory(f)).toEqual(before);
  });

  it('rejects an invalid policy before requesting a summary', async () => {
    const f = await fixture(async () => { throw new Error('Invalid policy must not contact the provider'); });
    const context = createContext({ ...f.options, policy: { reserveTokens: compactingModel.contextWindow + 1 } });
    expect(await context.compact(f.request)).toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });
  });

  it('preserves a newly appended message when the summary commit conflicts', async () => {
    const entered = gate(), release = gate();
    const f = await fixture(async () => { entered.release(); await release.promise; return completedMessage('Stale summary'); });
    const pending = f.context.compact(f.request);
    try {
      await entered.promise;
      await f.addTurns(f.sessionId, 6, 6);
    } finally { release.release(); }
    expect(await pending).toMatchObject({ status: 'failed', failure: { code: 'compaction_persist_failed' } });
    expect(activeHistory(f)).toHaveLength(12);
    expect(JSON.stringify(activeHistory(f))).toContain('answer 6:');
    expect(activeHistory(f).every(item => item.type === 'message')).toBe(true);
  });

  it.each(['compact', 'build'] as const)('serializes a concurrent %s and compaction within one session', async (first) => {
    const entered = gate(), release = gate();
    const f = await fixture(async () => { entered.release(); await release.promise; return completedMessage('Saved once'); });
    const one = first === 'build' ? f.context.build(f.buildRequest) : f.context.compact(f.request);
    await entered.promise;
    const two = f.context.compact(f.request);
    release.release();
    expect(await one).toMatchObject({ status: first === 'build' ? 'ready' : 'compacted' });
    expect(await two).toMatchObject({ status: 'nothing_to_compact' });
    expect(activeHistory(f).filter(item => item.type === 'compaction')).toHaveLength(1);
  });

  it('allows another session to compact while the first waits for its provider', async () => {
    const entered = gate(), release = gate(); let calls = 0;
    const f = await fixture(async () => { if (++calls === 1) { entered.release(); await release.promise; } return completedMessage('Independent summary'); });
    const other = f.catalog.createSession({ workspace_id: f.workspaceId });
    if (other.status !== 'created') throw new Error('Second session was not created');
    await f.addTurns(other.session.session_id);
    const first = f.context.compact(f.request);
    try {
      await entered.promise;
      expect(await f.context.compact({ ...f.request, sessionId: other.session.session_id })).toMatchObject({ status: 'compacted' });
      expect(activeHistory(f).every(item => item.type === 'message')).toBe(true);
    } finally { release.release(); await first; }
  });

  it('rolls a previous summary forward without losing or duplicating recent turns', async () => {
    const f = await fixture();
    expect(await f.context.compact(f.request)).toMatchObject({ status: 'compacted' });
    await f.addTurns(f.sessionId, 6, 8);
    expect(await f.context.compact(f.request)).toMatchObject({ status: 'compacted' });
    const history = activeHistory(f);
    expect(history.filter(item => item.type === 'compaction')).toHaveLength(1);
    expect(history.flatMap(item => item.type === 'message' ? [sessionMessageText(item.message).split(':')[0]] : []))
      .toEqual(['question 7', 'answer 7', 'question 8', 'answer 8']);
  });
});
