/* Verifies cancellation and restart semantics for process-local Active Runs. */
import { describe, expect, it, vi } from 'vitest';
import { createAgentRunService, type CreateAgentRunServiceOptions } from '@megumi/agent/agent-run';
import { ActiveRunStore } from '@megumi/agent/agent-run/core/active-run-store';
import { createMessageFlowDependencies } from './agent-run-test-helpers';

describe('process-local Agent Run cancellation', () => {
  it('cancels an active Run and releases its runtime state', async () => {
    const activeRuns = new ActiveRunStore();
    const deps = createMessageFlowDependencies({ repository: activeRuns });
    let finishEvents!: () => void;
    const eventsFinished = new Promise<void>((resolve) => { finishEvents = resolve; });
    deps.model_call_service.modelCall = vi.fn(() => ({
      status: 'started' as const,
      model_call_id: 'M1',
      events: eventsUntilCancelled(eventsFinished),
    }));
    deps.model_call_service.cancelModelCall.mockImplementation(() => {
      finishEvents();
      return { status: 'not_found', model_call_id: 'M1' };
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);
    const started = await service.startRun({
      request_id: 'REQ', workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'wait' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });
    expect(started.status).toBe('started');
    if (started.status !== 'started') return;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancelled = await service.cancelRun({ run_id: started.run.run_id });

    expect(cancelled).toMatchObject({ status: 'cancelled', run: { status: 'cancelled' } });
    expect(deps.session_service.saveAssistantReply).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      reason_code: 'user_cancelled',
      content: [],
    }));
    const terminalEventCall = deps.event_publisher.publish.mock.calls.findIndex(
      ([event]) => event.eventType === 'run.cancelled',
    );
    expect(deps.session_service.saveAssistantReply.mock.invocationCallOrder[0])
      .toBeLessThan(deps.event_publisher.publish.mock.invocationCallOrder[terminalEventCall]!);
    await vi.waitFor(() => expect(activeRuns.getRun(started.run.run_id)).toBeUndefined());
    expect(deps.model_call_service.cancelModelCall).toHaveBeenCalled();
  });

  it('commits streamed text as a cancelled partial reply before the terminal event', async () => {
    const deps = createMessageFlowDependencies();
    let finishEvents!: () => void;
    const eventsFinished = new Promise<void>((resolve) => { finishEvents = resolve; });
    deps.model_call_service.modelCall = vi.fn(() => ({
      status: 'started' as const,
      model_call_id: 'M1',
      events: (async function* () {
        yield { type: 'started' as const, model_call_id: 'M1', created_at: 'now' };
        yield { type: 'text_delta' as const, model_call_id: 'M1', delta: 'Partial', created_at: 'now' };
        await eventsFinished;
      })(),
    }));
    deps.model_call_service.cancelModelCall.mockImplementation(() => {
      finishEvents();
      return { status: 'not_found', model_call_id: 'M1' };
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);
    const started = await service.startRun({
      request_id: 'REQ', workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'wait' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });
    expect(started.status).toBe('started');
    if (started.status !== 'started') return;
    await vi.waitFor(() => expect(deps.event_publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'model_call.text_delta' }),
    ));

    await service.cancelRun({ run_id: started.run.run_id });

    expect(deps.session_service.saveAssistantReply).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      content: [{ type: 'text', text: 'Partial' }],
    }));
  });

  it('starts empty after a simulated process restart', () => {
    const previous = new ActiveRunStore();
    previous.createRun({
      run_id: 'R1', workspace_id: 'W1', session_id: 'S1',
      model_selection: { provider_id: 'P', model_id: 'M' },
      trigger: { type: 'user_input', user_message_id: 'U1' },
      status: 'waiting_for_approval', created_at: 'now',
    });

    expect(new ActiveRunStore().listRuns()).toEqual([]);
    expect(previous.listRuns()).toHaveLength(1);
  });
});

async function* eventsUntilCancelled(done: Promise<void>) {
  yield { type: 'started' as const, model_call_id: 'M1', created_at: 'now' };
  await done;
}
