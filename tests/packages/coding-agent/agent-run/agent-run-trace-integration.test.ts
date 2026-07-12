import { describe, expect, it, vi } from 'vitest';
import {
  createAgentRunService,
  type AgentRunTraceRecordInput,
  type CreateAgentRunServiceOptions,
  type ModelCallEvent,
} from '@megumi/coding-agent/agent-run';
import {
  collectEvents,
  createMessageFlowDependencies,
} from './agent-run-test-helpers';

describe('Agent Run trace integration', () => {
  it('records the no-tool run lifecycle without changing the run result', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies();
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

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
    await collectEvents(result.events);

    expect(records.map((record) => record.event_type)).toEqual(expect.arrayContaining([
      'run.started',
      'trace.tools.created',
      'trace.prompt.built',
      'trace.model_call.request_payload',
      'trace.model_call.event_received',
      'run.completed',
    ]));
    expect(records.find((record) => record.event_type === 'trace.model_call.request_payload')?.payload)
      .toEqual(expect.objectContaining({
        model_config: expect.objectContaining({
          provider_id: 'deepseek',
          model_id: 'deepseek-chat',
        }),
      }));
  });

  it('records tool calls, tool execution, runtime source continuation, and loop counters', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies();
    let modelCallIndex = 0;
    deps.model_call_service.modelCall = vi.fn(() => {
      modelCallIndex += 1;
      return {
        status: 'started' as const,
        model_call_id: `model-call-${modelCallIndex}`,
        events: modelCallIndex === 1
          ? asyncEvents<ModelCallEvent>([
              { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
              {
                type: 'tool_call',
                model_call_id: 'model-call-1',
                tool_call_id: 'tool-call-1',
                tool_name: 'read_file',
                input: { path: 'README.md' },
                arguments_text: '{"path":"README.md"}',
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ])
          : asyncEvents<ModelCallEvent>([
              { type: 'started', model_call_id: 'model-call-2', created_at: '2026-01-01T00:00:00.000Z' },
              {
                type: 'completed',
                model_call_id: 'model-call-2',
                content: 'done',
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ]),
      };
    });
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'read file' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'trace.tool_call.requested',
        payload: expect.objectContaining({
          tool_calls: [expect.objectContaining({
            tool_call_id: 'tool-call-1',
            input: { path: 'README.md' },
          })],
        }),
      }),
      expect.objectContaining({ event_type: 'trace.tool_execution.request' }),
      expect.objectContaining({ event_type: 'trace.tool_execution.result' }),
      expect.objectContaining({ event_type: 'trace.model_call.messages_appended' }),
      expect.objectContaining({ event_type: 'trace.loop.counters' }),
    ]));
  });

  it('records failed runs when the loop limit is exceeded', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies({
      max_tool_rounds: 1,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        {
          type: 'tool_call',
          model_call_id: 'model-call-1',
          tool_call_id: 'tool-call-1',
          tool_name: 'read_file',
          input: { path: 'README.md' },
          arguments_text: '{"path":"README.md"}',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'loop' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'run.failed',
        payload: expect.objectContaining({
          failure: expect.objectContaining({
            code: 'loop_limit_exceeded',
          }),
        }),
      }),
    ]));
  });
});

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
