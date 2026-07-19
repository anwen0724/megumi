/* Verifies final-reply acceptance and bounded protocol repair semantics. */
import { describe, expect, it, vi } from 'vitest';
import { createAgentRunService, type CreateAgentRunServiceOptions } from '@megumi/agent/agent-run';
import { collectEvents, createMessageFlowDependencies } from './agent-run-test-helpers';

describe('Agent final reply acceptance', () => {
  it('repairs a max-token response once and commits only the valid final candidate', async () => {
    const deps = createMessageFlowDependencies();
    let call = 0;
    deps.model_call_service.modelCall = vi.fn(() => {
      call += 1;
      return {
        status: 'started' as const,
        model_call_id: `M${call}`,
        events: events(call === 1 ? [
          { type: 'started' as const, model_call_id: 'M1', created_at: 'now' },
          { type: 'text_delta' as const, model_call_id: 'M1', delta: 'Truncated', created_at: 'now' },
          { type: 'completed' as const, model_call_id: 'M1', content: 'Truncated', finish_reason: 'max_tokens', created_at: 'now' },
        ] : [
          { type: 'started' as const, model_call_id: 'M2', created_at: 'now' },
          { type: 'completed' as const, model_call_id: 'M2', content: 'Complete answer', finish_reason: 'stop', created_at: 'now' },
        ]),
      };
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);
    const started = await start(service);
    if (started.status !== 'started') return;
    const runtimeEvents = await collectEvents(started.events);

    expect(deps.context_service.prepareModelCall).toHaveBeenCalledTimes(2);
    expect(deps.context_service.prepareModelCall.mock.calls[1]?.[0].currentTurn.runItems).toContainEqual(
      expect.objectContaining({ type: 'context', kind: 'historical_run_state' }),
    );
    expect(deps.session_service.saveModelResponse).not.toHaveBeenCalled();
    expect(deps.session_service.saveAssistantReply).toHaveBeenCalledTimes(1);
    expect(deps.session_service.saveAssistantReply).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', content: [{ type: 'text', text: 'Complete answer' }],
    }));
    expect(runtimeEvents.at(-1)?.eventType).toBe('run.completed');
  });

  it('fails after one repair when the provider never emits a terminal completion', async () => {
    const deps = createMessageFlowDependencies();
    let call = 0;
    deps.model_call_service.modelCall = vi.fn(() => {
      call += 1;
      return {
        status: 'started' as const,
        model_call_id: `M${call}`,
        events: events([
          { type: 'started' as const, model_call_id: `M${call}`, created_at: 'now' },
          { type: 'text_delta' as const, model_call_id: `M${call}`, delta: `Partial ${call}`, created_at: 'now' },
        ]),
      };
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);
    const started = await start(service);
    if (started.status !== 'started') return;
    const runtimeEvents = await collectEvents(started.events);

    expect(deps.session_service.saveAssistantReply).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      reason_code: 'runtime_protocol_violation',
      content: [{ type: 'text', text: 'Partial 2' }],
    }));
    expect(runtimeEvents.at(-1)?.eventType).toBe('run.failed');
  });
});

async function start(service: ReturnType<typeof createAgentRunService>) {
  return service.startRun({
    request_id: 'REQ', workspace_id: 'workspace-1',
    session: { type: 'existing', session_id: 'session-1' },
    user_input: { text: 'answer' },
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
  });
}

async function* events<T>(values: T[]): AsyncIterable<T> {
  yield* values;
}
