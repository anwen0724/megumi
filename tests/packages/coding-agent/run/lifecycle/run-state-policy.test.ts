// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertFailedRunHasTerminalReason,
  canCancelRunStatus,
  canResumeApprovalFromRunStatus,
  canTransitionRunStatus,
  isActiveRunStatus,
  isTerminalRunStatus,
} from '@megumi/coding-agent/state';
import type { Run } from '@megumi/shared/session';

function run(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'default',
    goal: 'Answer',
    status: 'running',
    createdAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent runtime state policy', () => {
  it('classifies active and terminal run statuses without adding retry-specific run statuses', () => {
    expect(isActiveRunStatus('queued')).toBe(true);
    expect(isActiveRunStatus('running')).toBe(true);
    expect(isActiveRunStatus('waiting_for_approval')).toBe(true);
    expect(isActiveRunStatus('paused')).toBe(true);
    expect(isActiveRunStatus('cancelling')).toBe(true);

    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
  });

  it('allows only 19.01 legal run status transitions', () => {
    expect(canTransitionRunStatus('queued', 'running')).toBe(true);
    expect(canTransitionRunStatus('running', 'waiting_for_approval')).toBe(true);
    expect(canTransitionRunStatus('waiting_for_approval', 'running')).toBe(true);
    expect(canTransitionRunStatus('waiting_for_approval', 'cancelling')).toBe(true);
    expect(canTransitionRunStatus('running', 'cancelling')).toBe(true);
    expect(canTransitionRunStatus('queued', 'cancelling')).toBe(true);
    expect(canTransitionRunStatus('cancelling', 'cancelled')).toBe(true);
    expect(canTransitionRunStatus('running', 'completed')).toBe(true);
    expect(canTransitionRunStatus('running', 'failed')).toBe(true);
    expect(canTransitionRunStatus('waiting_for_approval', 'failed')).toBe(true);
    expect(canTransitionRunStatus('queued', 'failed')).toBe(true);

    expect(canTransitionRunStatus('waiting_for_approval', 'completed')).toBe(false);
    expect(canTransitionRunStatus('completed', 'failed')).toBe(false);
    expect(canTransitionRunStatus('failed', 'cancelled')).toBe(false);
    expect(canTransitionRunStatus('cancelled', 'completed')).toBe(false);
  });

  it('keeps paused explicit but not product-expanded', () => {
    expect(canCancelRunStatus('paused')).toBe(false);
    expect(canResumeApprovalFromRunStatus('paused')).toBe(false);
    expect(canTransitionRunStatus('paused', 'running')).toBe(false);
    expect(canTransitionRunStatus('paused', 'failed')).toBe(false);
  });

  it('allows cancel only from queued, running, and waiting_for_approval', () => {
    expect(canCancelRunStatus('queued')).toBe(true);
    expect(canCancelRunStatus('running')).toBe(true);
    expect(canCancelRunStatus('waiting_for_approval')).toBe(true);
    expect(canCancelRunStatus('cancelling')).toBe(false);
    expect(canCancelRunStatus('completed')).toBe(false);
    expect(canCancelRunStatus('failed')).toBe(false);
    expect(canCancelRunStatus('cancelled')).toBe(false);
  });

  it('allows approval resume only from waiting_for_approval', () => {
    expect(canResumeApprovalFromRunStatus('waiting_for_approval')).toBe(true);
    expect(canResumeApprovalFromRunStatus('running')).toBe(false);
    expect(canResumeApprovalFromRunStatus('completed')).toBe(false);
    expect(canResumeApprovalFromRunStatus('failed')).toBe(false);
    expect(canResumeApprovalFromRunStatus('cancelled')).toBe(false);
  });

  it('requires failed runs to carry a terminal reason', () => {
    expect(() => assertFailedRunHasTerminalReason(run({
      status: 'failed',
      error: {
        code: 'runtime_protocol_violation',
        message: 'Loop limit exceeded.',
        severity: 'error',
        retryable: false,
        source: 'core',
        details: {
          reason: 'loop_limit_exceeded',
        },
      },
    }))).not.toThrow();

    expect(() => assertFailedRunHasTerminalReason(run({
      status: 'failed',
      error: {
        code: 'runtime_unknown',
        message: 'Bare failure.',
        severity: 'error',
        retryable: false,
        source: 'core',
      },
    }))).toThrow('Failed run must include a terminal reason');
  });
});
