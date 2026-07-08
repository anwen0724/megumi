import { describe, expect, it, vi } from 'vitest';
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

  it('feeds tool calls and tool results back through model-call continuation messages', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const modelCallRequests: unknown[] = [];
    const modelCall = vi.fn((request: unknown) => {
      modelCallRequests.push(request);
      if (modelCallRequests.length === 1) {
        return {
          status: 'started' as const,
          model_call_id: 'model-call-1',
          events: asyncEvents([
            { type: 'started' as const, model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
            {
              type: 'tool_call' as const,
              model_call_id: 'model-call-1',
              tool_call_id: 'provider-tool-call-1',
              tool_name: 'read_file',
              input: { path: 'README.md' },
              arguments_text: '{"path":"README.md"}',
              created_at: '2026-01-01T00:00:00.000Z',
            },
            {
              type: 'completed' as const,
              model_call_id: 'model-call-1',
              content: 'I need to read the file.',
              finish_reason: 'tool_calls',
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ]),
        };
      }

      return {
        status: 'started' as const,
        model_call_id: 'model-call-2',
        events: asyncEvents([
          { type: 'started' as const, model_call_id: 'model-call-2', created_at: '2026-01-01T00:00:00.000Z' },
          {
            type: 'completed' as const,
            model_call_id: 'model-call-2',
            content: 'Final answer.',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      };
    });
    deps.model_call_service.modelCall = modelCall as never;
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'read package' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    await collectEvents(result.events);

    expect(modelCallRequests).toHaveLength(2);
    expect(modelCallRequests[1]).toMatchObject({
      model_call_messages: [
        {
          role: 'assistant',
          content: 'I need to read the file.',
          tool_calls: [
            {
              tool_call_id: 'provider-tool-call-1',
              tool_name: 'read_file',
              arguments_text: '{"path":"README.md"}',
            },
          ],
        },
        {
          role: 'tool_result',
          tool_call_id: 'provider-tool-call-1',
          content: 'tool ok',
        },
      ],
    });
    expect(deps.session_service.saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      content_text: 'Final answer.',
    }));
  });
});

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
