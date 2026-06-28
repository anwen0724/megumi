// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resumeRunAfterApproval, type RunApprovalResumeRepositoryPort } from '@megumi/coding-agent/run';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { Run } from '@megumi/shared/session';

function run(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'default',
    goal: 'Answer',
    status: 'waiting_for_approval',
    createdAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function request(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    inputContext: {
      contextId: 'context-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      modelStepId: 'model-step-1',
      builtAt: '2026-06-14T00:00:01.000Z',
      budget: {
        maxTokens: 8_000,
        reservedTokens: 1_000,
      },
      parts: [],
      trace: {
        traceId: 'trace-1',
        items: [],
      },
    },
    createdAt: '2026-06-14T00:00:01.000Z',
  } as unknown as ModelStepRuntimeRequest;
}

function repository(initialRun: Run): RunApprovalResumeRepositoryPort & { savedRun?: Run } {
  return {
    savedRun: undefined,
    getRun: () => initialRun,
    saveRun(savedRun) {
      this.savedRun = savedRun;
      return savedRun;
    },
  };
}

describe('run approval resume lifecycle', () => {
  it('moves a waiting approval run back to running and emits the lifecycle event', () => {
    const repo = repository(run());

    const result = resumeRunAfterApproval({
      request: request(),
      fallbackRun: run({ runId: 'fallback-run' }),
      repository: repo,
      ids: { eventId: () => 'event-1' },
      decidedAt: '2026-06-14T00:00:10.000Z',
      lastSequence: 7,
    });

    expect(repo.savedRun).toMatchObject({ runId: 'run-1', status: 'running' });
    expect(result.run).toBe(repo.savedRun);
    expect(result.lastSequence).toBe(8);
    expect(result.event).toMatchObject({
      eventId: 'event-1',
      eventType: 'run.status.changed',
      runId: 'run-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      sequence: 8,
      createdAt: '2026-06-14T00:00:10.000Z',
      payload: {
        from: 'waiting_for_approval',
        to: 'running',
      },
    });
  });
});
