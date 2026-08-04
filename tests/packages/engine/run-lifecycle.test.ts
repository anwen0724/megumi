/*
 * Protects the explicit Run lifecycle and its terminal-state invariants.
 */
import { describe, expect, it } from 'vitest';
import type { RunFailure } from '@megumi/engine';
import {
  RunTransitionError,
  createRun,
  isTerminalRunStatus,
  transitionRun,
  type RunTransition,
} from '../../../packages/engine/src/run';

const failure: RunFailure = {
  code: 'context_failed',
  message: 'Context could not be built.',
  retryable: false,
};

function runningRun() {
  return createRun({
    runId: 'run:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model: {} as Parameters<typeof createRun>[0]['model'],
    permissionMode: 'ask',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
}

describe('Run lifecycle', () => {
  it('creates a Run directly in running state', () => {
    const run = runningRun();

    expect(run.status).toBe('running');
    expect(run.startedAt).toBe(run.createdAt);
    expect(run.completedAt).toBeUndefined();
    expect(run.failure).toBeUndefined();
  });

  it('supports waiting, resume, cancellation, and cancellation completion', () => {
    const waiting = transitionRun(runningRun(), {
      status: 'waiting',
      at: '2026-07-31T00:00:01.000Z',
    });
    const resumed = transitionRun(waiting, {
      status: 'running',
      at: '2026-07-31T00:00:02.000Z',
    });
    const cancelling = transitionRun(resumed, {
      status: 'cancelling',
      at: '2026-07-31T00:00:03.000Z',
    });
    const cancelled = transitionRun(cancelling, {
      status: 'cancelled',
      at: '2026-07-31T00:00:04.000Z',
    });

    expect([waiting.status, resumed.status, cancelling.status, cancelled.status]).toEqual([
      'waiting',
      'running',
      'cancelling',
      'cancelled',
    ]);
    expect(cancelled.completedAt).toBe('2026-07-31T00:00:04.000Z');
    expect(isTerminalRunStatus(cancelled.status)).toBe(true);
  });

  it('requires a failure only when entering failed', () => {
    expect(() => transitionRun(runningRun(), {
      status: 'failed',
      at: '2026-07-31T00:00:01.000Z',
    } as unknown as RunTransition)).toThrow(RunTransitionError);

    const failed = transitionRun(runningRun(), {
      status: 'failed',
      at: '2026-07-31T00:00:01.000Z',
      failure,
    });
    expect(failed.failure).toEqual(failure);

    expect(() => transitionRun(runningRun(), {
      status: 'completed',
      at: '2026-07-31T00:00:01.000Z',
      failure,
    } as unknown as RunTransition)).toThrow(RunTransitionError);
  });

  it('rejects unsupported and terminal transitions', () => {
    expect(() => transitionRun(runningRun(), {
      status: 'cancelled',
      at: '2026-07-31T00:00:01.000Z',
    })).toThrow(RunTransitionError);

    const completed = transitionRun(runningRun(), {
      status: 'completed',
      at: '2026-07-31T00:00:01.000Z',
    });
    expect(() => transitionRun(completed, {
      status: 'failed',
      at: '2026-07-31T00:00:02.000Z',
      failure,
    })).toThrow(RunTransitionError);
  });
});
