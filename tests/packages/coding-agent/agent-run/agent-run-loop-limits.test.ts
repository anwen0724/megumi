import { describe, expect, it, vi } from 'vitest';
import {
  createAgentRunService,
  type CreateAgentRunServiceOptions,
} from '@megumi/coding-agent/agent-run';
import { collectEvents, createInMemoryAgentRunRepository, createMessageFlowDependencies } from './agent-run-test-helpers';

describe('Agent Run loop limits', () => {
  it('uses coding-agent friendly default loop limits', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    delete (deps as Partial<typeof deps>).limits;

    let modelCallCount = 0;
    deps.model_call_service.modelCall = vi.fn(() => {
      modelCallCount += 1;
      return {
        status: 'started' as const,
        model_call_id: `model-call-${modelCallCount}`,
        events: asyncEvents(
          modelCallCount <= 8
            ? toolCallModelEvents(`model-call-${modelCallCount}`, `tool-call-${modelCallCount}`)
            : [
                {
                  type: 'started',
                  model_call_id: `model-call-${modelCallCount}`,
                  created_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  type: 'completed',
                  model_call_id: `model-call-${modelCallCount}`,
                  content: 'done',
                  created_at: '2026-01-01T00:00:00.000Z',
                },
              ],
        ),
      };
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'inspect several files' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    await collectEvents(result.events);
    expect(modelCallCount).toBe(9);
    expect(repository.getRun(result.run.run_id)).toMatchObject({
      status: 'completed',
    });
  });

  it('fails the run when maxModelCalls is exceeded', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      max_model_calls: 1,
      modelEvents: toolCallModelEvents(),
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'inspect file' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collectEvents(result.events);
    expect(repository.getRun(result.run.run_id)).toMatchObject({
      status: 'failed',
      failure: {
        code: 'loop_limit_exceeded',
      },
    });
    expect(events.map((event) => event.type)).toContain('run.failed');
  });

  it('fails the run when maxToolRounds is exceeded', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      max_model_calls: 4,
      max_tool_rounds: 0,
      modelEvents: toolCallModelEvents(),
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'inspect file' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    await collectEvents(result.events);
    expect(repository.getRun(result.run.run_id)).toMatchObject({
      status: 'failed',
      failure: {
        code: 'loop_limit_exceeded',
      },
    });
  });
});

function toolCallModelEvents(
  modelCallId = 'model-call-1',
  toolCallId = 'tool-call-1',
): Array<Record<string, unknown>> {
  return [
    { type: 'started', model_call_id: modelCallId, created_at: '2026-01-01T00:00:00.000Z' },
    {
      type: 'tool_call',
      model_call_id: modelCallId,
      tool_call_id: toolCallId,
      tool_name: 'read_file',
      input: { path: 'README.md' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
    { type: 'completed', model_call_id: modelCallId, content: '', created_at: '2026-01-01T00:00:00.000Z' },
  ];
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
