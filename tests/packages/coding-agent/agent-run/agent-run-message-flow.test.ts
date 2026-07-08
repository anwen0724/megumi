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
import { RuntimeEventSchema } from '@megumi/coding-agent/events';

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
    expectRuntimeEventsSchemaValid(events);
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
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'run.started',
      'model_call.started',
      'model_call.completed',
      'run.completed',
    ]));
    expect(events.find((event) => event.eventType === 'run.started')).toMatchObject({
      payload: {
        runKind: 'agent',
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
      },
    });
    expect(events.map((event) => String(event.eventType))).not.toContain('error.raised');
    expect(events.map((event) => String(event.eventType))).not.toContain(['tool', 'execution'].join('_') + '.started');
    expect(events.map((event) => String(event.eventType))).not.toContain(['tool', 'execution'].join('_') + '.completed');
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

    const events = await collectEvents(result.events);
    expectRuntimeEventsSchemaValid(events);

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

  it('maps thinking and model retry events into standard RuntimeEvents', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        {
          type: 'thinking_started',
          model_call_id: 'model-call-1',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'thinking_delta',
          model_call_id: 'model-call-1',
          delta: 'I should answer directly.',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'thinking_completed',
          model_call_id: 'model-call-1',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'retrying',
          model_call_id: 'model-call-1',
          attempt: 1,
          max_attempts: 2,
          failure: {
            code: 'model_call_failed',
            message: 'Provider stream failed.',
            retryable: true,
          },
          retry_after_ms: 1,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'completed',
          model_call_id: 'model-call-1',
          content: 'assistant reply',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
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
    expectRuntimeEventsSchemaValid(events);
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'model.thinking.started',
      'model.thinking.delta',
      'model.thinking.completed',
      'retry.started',
      'retry.completed',
      'model_call.completed',
      'run.completed',
    ]));
    expect(events.map((event) => event.eventType)).not.toContain('model_call.failed');
  });
});

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}

function expectRuntimeEventsSchemaValid(events: unknown[]): void {
  for (const event of events) {
    expect(RuntimeEventSchema.safeParse(event).success).toBe(true);
  }
}
