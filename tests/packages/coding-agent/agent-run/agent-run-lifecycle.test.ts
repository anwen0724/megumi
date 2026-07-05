import { describe, expect, it } from 'vitest';
import type { AgentRun } from '@megumi/coding-agent/agent-run';
import {
  assertAgentRunStatusTransition,
  transitionAgentRunStatus,
} from '@megumi/coding-agent/agent-run/core/run-lifecycle';

describe('agent-run lifecycle', () => {
  it.each([
    ['queued', 'running'],
    ['running', 'waiting_for_approval'],
    ['waiting_for_approval', 'running'],
    ['running', 'cancelling'],
    ['waiting_for_approval', 'cancelling'],
    ['cancelling', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['waiting_for_approval', 'failed'],
    ['cancelling', 'failed'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertAgentRunStatusTransition(from, to)).not.toThrow();
  });

  it.each([
    ['cancelled', 'running'],
    ['completed', 'running'],
    ['failed', 'running'],
    ['queued', 'completed'],
    ['running', 'cancelled'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertAgentRunStatusTransition(from, to)).toThrow();
  });

  it('transitions run while preserving lifecycle timestamps and failure', () => {
    const running = transitionAgentRunStatus({
      run: sampleRun(),
      to: 'running',
      changed_at: '2026-01-01T00:00:01.000Z',
    });
    const failed = transitionAgentRunStatus({
      run: running,
      to: 'failed',
      changed_at: '2026-01-01T00:00:02.000Z',
      failure: {
        code: 'runtime_interrupted',
        message: 'Runtime interrupted.',
      },
    });

    expect(running.started_at).toBe('2026-01-01T00:00:01.000Z');
    expect(failed.completed_at).toBe('2026-01-01T00:00:02.000Z');
    expect(failed.failure?.code).toBe('runtime_interrupted');
  });
});

function sampleRun(): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status: 'queued',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}
