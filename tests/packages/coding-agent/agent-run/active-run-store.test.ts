/* Verifies that Active Run state is process-local and supports parallel ToolCall Steps. */
import { describe, expect, it } from 'vitest';
import type { AgentRun, ToolCallStep } from '@megumi/coding-agent/agent-run';
import { ActiveRunStore } from '@megumi/coding-agent/agent-run/core/active-run-store';

describe('ActiveRunStore', () => {
  it('owns lifecycle, parallel steps, approvals, and terminal release in memory', () => {
    const store = new ActiveRunStore();
    const run = sampleRun();
    store.createRun(run);
    store.addStep(toolStep('T1'));
    store.addStep(toolStep('T2'));

    expect(store.listSteps(run.run_id).filter((step) => step.status === 'executing')).toHaveLength(2);
    store.createApprovalRequest({
      approval_request_id: 'A1', run_id: run.run_id,
      subject: { type: 'tool_call', tool_call_id: 'T1', tool_name: 'read_file', input: {} },
      status: 'pending', created_at: '2026-07-12T00:00:00.000Z',
    });
    expect(store.listPendingApprovalRequestsByRun(run.run_id)).toHaveLength(1);
    expect(store.nextRuntimeEventSequence(run.run_id)).toBe(1);
    expect(store.nextRuntimeEventSequence(run.run_id)).toBe(2);

    store.release(run.run_id);
    expect(store.getRun(run.run_id)).toBeUndefined();
    expect(store.listPendingApprovalRequestsByRun(run.run_id)).toEqual([]);
    expect(new ActiveRunStore().getRun(run.run_id)).toBeUndefined();
  });
});

function sampleRun(): AgentRun {
  return {
    run_id: 'R1', workspace_id: 'W1', session_id: 'S1',
    model_selection: { provider_id: 'P1', model_id: 'M1' },
    trigger: { type: 'user_input', user_message_id: 'U1' },
    status: 'running', created_at: '2026-07-12T00:00:00.000Z',
  };
}

function toolStep(toolCallId: string): ToolCallStep {
  return {
    type: 'tool_call', run_id: 'R1', tool_call_id: toolCallId,
    source_model_call_id: 'M1', call_order: toolCallId === 'T1' ? 0 : 1,
    tool_name: 'read_file', input: {}, arguments_text: '{}',
    status: 'executing', created_at: '2026-07-12T00:00:00.000Z',
  };
}
