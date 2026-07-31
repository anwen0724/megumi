/*
 * Verifies in-process Run concurrency, start idempotency, and bounded retention.
 */
import { describe, expect, it } from 'vitest';
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/agent/session';
import type { EngineClock, RunFailure } from '@megumi/engine';
import {
  ActiveRunStore,
  type StartRequestFingerprint,
} from '../../../packages/engine/src/active-run-store';
import { createRun, transitionRun } from '../../../packages/engine/src/run';

const fingerprint: StartRequestFingerprint = {
  workspaceId: 'workspace:1',
  sessionId: 'session:1',
  inputDigest: 'sha256:input-1',
};
const failure: RunFailure = {
  code: 'session_failed',
  message: 'User message was not saved.',
};

function createMutableClock(initial: string): EngineClock & { set(value: string): void } {
  let current = initial;
  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
  };
}

function createTestRun(input: {
  runId: string;
  requestId: string;
  sessionId: string;
}) {
  return createRun({
    ...input,
    workspaceId: 'workspace:1',
    userMessageId: `message:${input.runId}`,
    model: {} as Parameters<typeof createRun>[0]['model'],
    permissionMode: 'ask',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
}

function startedResult(run: ReturnType<typeof createTestRun>) {
  const userMessage = {
    message: {
      message_id: run.userMessageId,
      session_id: run.sessionId,
      message_kind: 'user_message',
      content: [{ type: 'text', text: 'hello' }],
      created_at: run.createdAt,
      completed_at: run.createdAt,
    },
    attachments: [],
  } as SessionMessageWithAttachments;
  const userEntry = {
    entry_id: `entry:${run.runId}`,
    session_id: run.sessionId,
    entry_type: 'message',
    message_id: run.userMessageId,
    created_at: run.createdAt,
  } satisfies SessionEntry;
  return { run, userMessage, userEntry };
}

describe('ActiveRunStore', () => {
  it('shares one pending establishment result for the same requestId', async () => {
    const clock = createMutableClock('2026-07-31T00:00:00.000Z');
    const store = new ActiveRunStore({ clock, terminalRunRetentionMs: 1_000 });
    const run = createTestRun({
      runId: 'run:1',
      requestId: 'request:1',
      sessionId: 'session:1',
    });

    expect(store.reserveStart({ requestId: run.requestId, fingerprint, run })).toMatchObject({
      status: 'reserved',
      run,
    });
    const duplicate = store.reserveStart({
      requestId: run.requestId,
      fingerprint,
      run: createTestRun({
        runId: 'run:duplicate',
        requestId: run.requestId,
        sessionId: run.sessionId,
      }),
    });
    expect(duplicate.status).toBe('pending');

    const result = startedResult(run);
    store.completeStart({ requestId: run.requestId, result });

    if (duplicate.status !== 'pending') throw new Error('Expected pending duplicate');
    await expect(duplicate.completion).resolves.toEqual({ status: 'started', result });
    expect(store.reserveStart({ requestId: run.requestId, fingerprint, run })).toEqual({
      status: 'already_started',
      result,
    });
  });

  it('rejects a changed request fingerprint and permits retry after failed establishment', async () => {
    const clock = createMutableClock('2026-07-31T00:00:00.000Z');
    const store = new ActiveRunStore({ clock, terminalRunRetentionMs: 1_000 });
    const run = createTestRun({
      runId: 'run:1',
      requestId: 'request:1',
      sessionId: 'session:1',
    });
    store.reserveStart({ requestId: run.requestId, fingerprint, run });

    expect(store.reserveStart({
      requestId: run.requestId,
      fingerprint: { ...fingerprint, inputDigest: 'sha256:changed' },
      run,
    })).toEqual({ status: 'request_conflict' });

    const pending = store.reserveStart({ requestId: run.requestId, fingerprint, run });
    if (pending.status !== 'pending') throw new Error('Expected pending duplicate');
    store.failStart({ requestId: run.requestId, failure });
    await expect(pending.completion).resolves.toEqual({ status: 'failed', failure });

    expect(store.reserveStart({ requestId: run.requestId, fingerprint, run }).status).toBe(
      'reserved',
    );
  });

  it('allows one non-terminal Run per Session and concurrent Runs across Sessions', () => {
    const clock = createMutableClock('2026-07-31T00:00:00.000Z');
    const store = new ActiveRunStore({ clock, terminalRunRetentionMs: 1_000 });
    const first = createTestRun({
      runId: 'run:1',
      requestId: 'request:1',
      sessionId: 'session:1',
    });
    store.reserveStart({ requestId: first.requestId, fingerprint, run: first });

    const sameSession = createTestRun({
      runId: 'run:2',
      requestId: 'request:2',
      sessionId: 'session:1',
    });
    expect(store.reserveStart({
      requestId: sameSession.requestId,
      fingerprint: { ...fingerprint, inputDigest: 'sha256:input-2' },
      run: sameSession,
    })).toEqual({ status: 'session_busy', activeRun: first });

    const otherSession = createTestRun({
      runId: 'run:3',
      requestId: 'request:3',
      sessionId: 'session:2',
    });
    expect(store.reserveStart({
      requestId: otherSession.requestId,
      fingerprint: {
        ...fingerprint,
        sessionId: 'session:2',
        inputDigest: 'sha256:input-3',
      },
      run: otherSession,
    }).status).toBe('reserved');
  });

  it('retains terminal summaries for the configured duration and releases the Session', () => {
    const clock = createMutableClock('2026-07-31T00:00:00.000Z');
    const store = new ActiveRunStore({ clock, terminalRunRetentionMs: 1_000 });
    const run = createTestRun({
      runId: 'run:1',
      requestId: 'request:1',
      sessionId: 'session:1',
    });
    const result = startedResult(run);
    store.reserveStart({ requestId: run.requestId, fingerprint, run });
    store.completeStart({ requestId: run.requestId, result });

    const completed = transitionRun(run, {
      status: 'completed',
      at: '2026-07-31T00:00:01.000Z',
    });
    clock.set('2026-07-31T00:00:01.000Z');
    store.updateRun(completed);

    expect(store.getRun(run.runId)).toEqual(completed);
    expect(store.getStartedResult(run.requestId)).toMatchObject({ run: completed });

    const next = createTestRun({
      runId: 'run:2',
      requestId: 'request:2',
      sessionId: 'session:1',
    });
    expect(store.reserveStart({
      requestId: next.requestId,
      fingerprint: { ...fingerprint, inputDigest: 'sha256:input-2' },
      run: next,
    }).status).toBe('reserved');

    clock.set('2026-07-31T00:00:02.001Z');
    expect(store.getRun(run.runId)).toBeUndefined();
    expect(store.getStartedResult(run.requestId)).toBeUndefined();
  });
});
