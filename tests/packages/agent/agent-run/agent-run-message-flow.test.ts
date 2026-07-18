import { describe, expect, it, vi } from 'vitest';
import {
  createAgentRunService,
  type CreateAgentRunServiceOptions,
} from '@megumi/agent/agent-run';
import {
  collectEvents,
  createInMemoryAgentRunRepository,
  createMessageFlowDependencies,
} from './agent-run-test-helpers';
import { RuntimeEventSchema } from '@megumi/agent/events';

describe('Agent Run message flow', () => {
  it('starts one run, builds prompts, saves assistant output, captures memory, and publishes events', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const prepareModelCall = deps.context_service.prepareModelCall.getMockImplementation();
    deps.context_service.prepareModelCall.mockImplementation(async (request) => {
      request.onCompactionProgress?.({
        status: 'started',
        compactionId: 'compaction-1',
        tokensBefore: 204_900,
        summarizedSourceCount: 12,
        firstKeptSourceId: 'entry-recent-1',
      });
      request.onCompactionProgress?.({
        status: 'completed',
        compactionId: 'compaction-1',
        tokensBefore: 204_900,
        summarizedSourceCount: 12,
        firstKeptSourceId: 'entry-recent-1',
      });
      return prepareModelCall!(request);
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
    expect(result.request_id).toBe('request-1');
    expect(result.run.run_id).not.toBe('request-1');
    expect(result.user_message_id).toBe('message-1');
    expect(deps.settings_service.resolveProviderRuntimeConfig).toHaveBeenCalledWith({
      provider_id: 'deepseek',
      model_id: 'deepseek-chat',
    });
    expect(deps.tool_registry_service.listAvailableTools).toHaveBeenCalledTimes(1);
    expect(deps.context_service.prepareModelCall).toHaveBeenCalledTimes(1);
    expect(deps.context_service.prepareModelCall).toHaveBeenCalledWith(expect.objectContaining({
      currentTurn: expect.objectContaining({
        runId: result.run.run_id,
        lastEntryId: 'entry-message-1',
        userEntry: { entryId: 'entry-message-1' },
        userMessage: {
          type: 'user_message',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'file', fileId: 'attachment-1' },
          ],
        },
        runItems: [],
      }),
    }));
    expect(JSON.stringify(deps.context_service.prepareModelCall.mock.calls[0]?.[0].currentTurn))
      .not.toContain('README.md');
    expect(deps.session_service.saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      run_id: result.run.run_id,
      session_id: 'session-1',
      content: [{ type: 'text', text: 'assistant reply' }],
    }));
    expect(deps.memory_service.captureCompletedRun).toHaveBeenCalledWith(expect.objectContaining({
      run_id: result.run.run_id,
      session_id: 'session-1',
    }));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'run.started',
      'model_call.started',
      'model_call.completed',
      'context.compaction.started',
      'context.compaction.completed',
      'run.completed',
    ]));
    expect(events.find((event) => event.eventType === 'context.compaction.completed')).toMatchObject({
      runId: result.run.run_id,
      sessionId: 'session-1',
      payload: {
        compactionId: 'compaction-1',
        tokensBefore: 204_900,
        summarizedSourceCount: 12,
      },
    });
    expect(events.find((event) => event.eventType === 'run.started')).toMatchObject({
      payload: {
        runKind: 'agent',
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
      },
    });
    expect(events.find((event) => event.eventType === 'model_call.completed')).toMatchObject({
      payload: {
        modelCallId: 'model-call-1',
        finishReason: 'stop',
        content: [{ type: 'text', text: 'assistant reply' }],
      },
    });
    expect(events.map((event) => String(event.eventType))).not.toContain('error.raised');
    expect(events.map((event) => String(event.eventType))).not.toContain(['tool', 'execution'].join('_') + '.started');
    expect(events.map((event) => String(event.eventType))).not.toContain(['tool', 'execution'].join('_') + '.completed');
    expect(repository.getRun(result.run.run_id)).toBeUndefined();
    expect(deps.context_service.recordCompletedRunUsage.mock.calls[0]?.[0])
      .not.toHaveProperty('providerInputTokens');
  });

  it('applies a consumed branch draft as the parent for the next user message', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const branchService = {
      consumeBranchDraft: vi.fn(() => ({
        status: 'consumed' as const,
        branch_draft: {
          branch_marker_id: 'branch-1',
          session_id: 'session-1',
          source_message_id: 'assistant-message-source',
          source_entry_id: 'entry-assistant-source',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      })),
    };
    const service = createAgentRunService({
      ...deps,
      branch_service: branchService,
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      branch_marker_id: 'branch-1',
      user_input: { text: 'branch from there' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    expect(branchService.consumeBranchDraft).toHaveBeenCalledWith({
      session_id: 'session-1',
      branch_marker_id: 'branch-1',
    });
    expect(deps.session_service.saveUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      parent_entry_id: 'entry-assistant-source',
    }));
  });

  it('records completed usage without refreshing the legacy usage monitor', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const start = vi.fn(async () => ({ status: 'ok' as const }));
    const refreshSession = vi.fn(async () => undefined);
    const contextUsageWindowProvider = vi.fn(() => ({
      model_id: 'deepseek-chat',
      context_window_tokens: 256_000,
    }));
    const service = createAgentRunService({
      ...deps,
      context_usage_monitor: {
        start,
        refreshSession,
        markCompactionRunning: vi.fn(),
      },
      context_usage_window_provider: contextUsageWindowProvider,
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

    expect(start).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(contextUsageWindowProvider).not.toHaveBeenCalled();
    expect(deps.context_service.recordCompletedRunUsage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      runId: 'run-1',
    }));
    expect(deps.context_service.recordCompletedRunUsage.mock.calls[0]?.[0])
      .not.toHaveProperty('providerInputTokens');
  });

  it('prefers final provider input tokens for the completed usage snapshot', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        {
          type: 'completed',
          model_call_id: 'model-call-1',
          content: 'assistant reply',
          usage: { input_tokens: 777 },
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun(runRequest());
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(deps.context_service.recordCompletedRunUsage).toHaveBeenCalledWith(expect.objectContaining({
      providerInputTokens: 777,
    }));
  });

  it('does not record a snapshot for a failed run', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const service = createAgentRunService({
      ...deps,
      model_call_service: {
        ...deps.model_call_service,
        modelCall: vi.fn(() => ({
          status: 'failed' as const,
          failure: { code: 'model_call_failed' as const, message: 'provider failed' },
        })),
      },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun(runRequest());
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(repository.getRun(result.run.run_id)).toBeUndefined();
    expect(deps.context_service.recordCompletedRunUsage).not.toHaveBeenCalled();
  });

  it('does not record a snapshot while a run is waiting for approval', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        {
          type: 'tool_call',
          model_call_id: 'model-call-1',
          tool_call_id: 'provider-tool-call-1',
          tool_name: 'read_file',
          input: { path: 'README.md' },
          arguments_text: '{"path":"README.md"}',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        { type: 'completed', model_call_id: 'model-call-1', content: '', finish_reason: 'tool_calls', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const service = createAgentRunService({
      ...deps,
      permission_service: {
        ...deps.permission_service,
        evaluateToolExecution: vi.fn(() => ({
          status: 'ok' as const,
          decision: {
            type: 'requires_approval' as const,
            reason: 'needs approval',
            execution_class: 'read_only' as const,
            approval: { allowed_scopes: ['once' as const], default_scope: 'once' as const },
          },
        })),
      },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun(runRequest());
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(repository.getRun(result.run.run_id)?.status).toBe('waiting_for_approval');
    expect(repository.listSteps(result.run.run_id)).toEqual([
      expect.objectContaining({ type: 'model_call', model_call_id: 'model-call-1', status: 'completed' }),
      expect.objectContaining({ type: 'tool_call', source_model_call_id: 'model-call-1', call_order: 0, status: 'waiting_for_approval' }),
    ]);
    expect(deps.context_service.recordCompletedRunUsage).not.toHaveBeenCalled();
  });

  it('persists approved and deferred Tool Results while preserving Step order across approval barriers', async () => {
    const repository = createInMemoryAgentRunRepository();
    const toolCalls = ['call-1', 'call-2', 'call-3'].map((tool_call_id) => ({
      type: 'tool_call' as const,
      model_call_id: 'model-call-1',
      tool_call_id,
      tool_name: 'read_file',
      input: { path: `${tool_call_id}.md` },
      arguments_text: JSON.stringify({ path: `${tool_call_id}.md` }),
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    const deps = createMessageFlowDependencies({
      repository,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        ...toolCalls,
        { type: 'completed', model_call_id: 'model-call-1', content: '', finish_reason: 'tool_calls', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    let evaluation = 0;
    let approvalId = 0;
    const service = createAgentRunService({
      ...deps,
      ids: {
        ...deps.ids,
        approval_request_id: () => `approval-${approvalId += 1}`,
      },
      permission_service: {
        evaluateToolExecution: vi.fn(() => {
          evaluation += 1;
          return {
            status: 'ok' as const,
            decision: evaluation === 2
              ? { type: 'allow' as const, reason: 'allowed', execution_class: 'read_only' as const }
              : {
                  type: 'requires_approval' as const,
                  reason: 'needs approval',
                  execution_class: 'read_only' as const,
                  approval: { allowed_scopes: ['once' as const], default_scope: 'once' as const },
                },
          };
        }),
        validateApprovalDecision: vi.fn(async () => ({ status: 'valid' as const })),
        applyApprovalDecision: vi.fn(async () => ({ status: 'applied' as const })),
      },
    } as unknown as CreateAgentRunServiceOptions);

    const started = await service.startRun(runRequest());
    expect(started.status).toBe('started');
    if (started.status !== 'started') return;
    await collectEvents(started.events);

    const resumed = await service.resumeRunAfterApproval({
      approval_request_id: 'approval-1',
      decision: {
        approval_request_id: 'approval-1', decision: 'approved', scope: 'once', decided_by: 'user',
      },
    });
    expect(resumed.status).toBe('resumed');
    if (resumed.status !== 'resumed') return;
    await collectEvents(resumed.events);

    expect(repository.getRun(started.run.run_id)?.status).toBe('waiting_for_approval');
    expect(repository.listSteps(started.run.run_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_call', tool_call_id: 'call-1', call_order: 0, status: 'completed' }),
      expect.objectContaining({ type: 'tool_call', tool_call_id: 'call-2', call_order: 1, status: 'completed' }),
      expect.objectContaining({ type: 'tool_call', tool_call_id: 'call-3', call_order: 2, status: 'waiting_for_approval' }),
    ]));
    expect(deps.session_service.saveToolResultMessage).toHaveBeenCalledTimes(2);
    const firstSaved = deps.session_service.saveToolResultMessage.mock.calls[0]![0];
    const secondSaved = deps.session_service.saveToolResultMessage.mock.calls[1]![0];
    expect(firstSaved.tool_call_id).toBe('call-1');
    expect(secondSaved).toMatchObject({
      tool_call_id: 'call-2',
      parent_entry_id: `entry:${firstSaved.message_id}`,
    });
  });

  it('keeps a successful run completed when snapshot recording fails', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({ repository });
    const record = vi.fn();
    const service = createAgentRunService({
      ...deps,
      context_service: {
        ...deps.context_service,
        recordCompletedRunUsage: vi.fn(() => ({
          status: 'failed' as const,
          failure: { code: 'usage_snapshot_invalid' as const, message: 'snapshot rejected', retryable: false },
        })),
      },
      trace_logger: { record },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun(runRequest());
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(repository.getRun(result.run.run_id)).toBeUndefined();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'trace.context.snapshot_failed',
      payload: expect.objectContaining({ code: 'usage_snapshot_invalid' }),
    }));
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
              usage: { input_tokens: 333 },
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
    const service = createAgentRunService({
      ...deps,
      model_call_service: { ...deps.model_call_service, modelCall },
    } as unknown as CreateAgentRunServiceOptions);

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
    expect(modelCallRequests[1]).not.toHaveProperty('model_call_messages');
    expect(modelCallRequests[1]).toMatchObject({
      prompt: {
        conversation: [
          expect.objectContaining({ type: 'user_message' }),
          { type: 'assistant_message', content: [{ type: 'text', text: 'I need to read the file.' }] },
          { type: 'tool_call', toolCallId: 'provider-tool-call-1', toolName: 'read_file', arguments: { path: 'README.md' } },
          { type: 'tool_result', toolCallId: 'provider-tool-call-1', toolName: 'read_file', status: 'success', content: [{ type: 'text', text: 'tool ok' }] },
        ],
      },
    });
    expect(deps.context_service.prepareModelCall).toHaveBeenNthCalledWith(2, expect.objectContaining({
      currentTurn: expect.objectContaining({ runItems: expect.any(Array) }),
    }));
    expect(deps.context_service.recordCompletedRunUsage.mock.calls[0]?.[0])
      .not.toHaveProperty('providerInputTokens');
    expect(deps.session_service.saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'Final answer.' }],
    }));
    expect(deps.session_service.saveAssistantMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      content: [
        { type: 'text', text: 'I need to read the file.' },
        {
          type: 'toolCall', id: 'provider-tool-call-1', name: 'read_file',
          argumentsText: '{"path":"README.md"}',
        },
      ],
      stop_reason: 'tool_calls',
    }));
    expect(deps.session_service.saveToolResultMessage).toHaveBeenCalledWith(expect.objectContaining({
      tool_call_id: 'provider-tool-call-1',
      status: 'success',
      content: [{ type: 'text', text: 'tool ok' }],
    }));
    expect(events.find((event) => event.eventType === 'tool_result.created')).toMatchObject({
      payload: {
        toolResultId: 'tool-result:provider-tool-call-1',
        toolCallId: 'provider-tool-call-1',
        toolName: 'read_file',
        kind: 'success',
        content: [{ type: 'text', text: 'tool ok' }],
      },
    });
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
    const parsed = RuntimeEventSchema.safeParse(event);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify({ event, issues: parsed.error.issues }, null, 2))
      .toBe(true);
  }
}

function runRequest() {
  return {
    request_id: 'request-1',
    workspace_id: 'workspace-1',
    session: { type: 'existing' as const, session_id: 'session-1' },
    user_input: { text: 'hello' },
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    permission_mode: 'default' as const,
  };
}
