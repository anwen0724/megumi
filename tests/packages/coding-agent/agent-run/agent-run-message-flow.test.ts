import { describe, expect, it } from 'vitest';
import {
  createAgentRunService,
  type CreateAgentRunServiceOptions,
} from '@megumi/coding-agent/agent-run';
import {
  collectEvents,
  createInMemoryAgentRunRepository,
  createMessageFlowDependencies,
} from './agent-run-test-helpers';

describe('Agent Run message flow', () => {
  it('starts one run, builds prompts, saves assistant output, captures memory, and publishes events', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'hello' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collectEvents(result.events);
    expect(result.request_id).toBe('request-1');
    expect(result.run.run_id).not.toBe('request-1');
    expect(result.user_message_id).toBe('message-1');
    expect(deps.settings_service.resolveProviderRuntimeConfig).toHaveBeenCalledWith({
      provider_id: 'deepseek',
      model_id: 'deepseek-chat',
    });
    expect(deps.tool_registry_service.listAvailableTools).toHaveBeenCalledTimes(1);
    expect(deps.context_service.buildPrompt).toHaveBeenCalledTimes(1);
    expect(deps.session_service.saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      run_id: result.run.run_id,
      session_id: 'session-1',
      content_text: 'assistant reply',
    }));
    expect(deps.memory_service.captureCompletedRun).toHaveBeenCalledWith(expect.objectContaining({
      run_id: result.run.run_id,
      session_id: 'session-1',
    }));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'run.started',
      'model_call.started',
      'model_call.completed',
      'run.completed',
    ]));
    expect(repository.getRun(result.run.run_id)?.status).toBe('completed');
  });
});
