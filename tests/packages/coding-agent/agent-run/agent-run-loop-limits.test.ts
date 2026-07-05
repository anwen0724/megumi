import { describe, expect, it } from 'vitest';
import {
  createAgentRunService,
  type CreateAgentRunServiceOptions,
} from '@megumi/coding-agent/agent-run';
import { collectEvents, createInMemoryAgentRunRepository, createMessageFlowDependencies } from './agent-run-test-helpers';

describe('Agent Run loop limits', () => {
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

function toolCallModelEvents(): Array<Record<string, unknown>> {
  return [
    { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
    {
      type: 'tool_call',
      model_call_id: 'model-call-1',
      tool_call_id: 'tool-call-1',
      tool_name: 'read_file',
      input: { path: 'README.md' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
    { type: 'completed', model_call_id: 'model-call-1', content: '', created_at: '2026-01-01T00:00:00.000Z' },
  ];
}
