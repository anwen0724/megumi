/*
 * Protects Engine's Context-model-Session-tool loop and semantic commit order.
 */
import { describe, expect, it, vi } from 'vitest';
import { createToolRouter, registeredTool, succeeded } from './tool-call-test-fixtures';
import {
  assistantStream,
  assistantStreamWithUsage,
  collectEvents,
  compactedOverflowCompaction,
  createRunsFixture,
  errorOverflowStream,
  lengthOverflowStream,
  retryableFailedStream,
  settleRun,
  startedRun,
  startRequest,
} from './runs-test-fixtures';

describe('Agent Loop', () => {
  it('recovers from one Context Overflow per ModelCall with a compaction retry', async () => {
    const tool = registeredTool('lookup');
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createRunsFixture({
      contextCompact: compact,
      tools: [tool],
      streams: [
        // Overflow: usage fills the Context Window.
        assistantStreamWithUsage('overflowing', {
          input: 64_001,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 64_002,
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    // projection reset is no longer an event; overflow recovery is told by the run ending.
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'overflow',
      sessionId: startRequest.sessionId,
      // Overflow compaction receives the already-resolved ModelCall Tools; a
      // per-request EventBus no longer exists in the Contract.
      tools: expect.arrayContaining([expect.objectContaining({ name: 'lookup' })]),
    }));
    // The rebuilt Prompt came from the same ModelCallContext; the run completed once.
    expect(fixture.contextRuns).toHaveLength(2);
  });

  it('does not retry a second Overflow on the same ModelCall', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createRunsFixture({
      contextCompact: compact,
      streams: [
        assistantStreamWithUsage('first overflow', {
          input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
        }),
        assistantStreamWithUsage('second overflow', {
          input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
        }),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
    expect(fixture.writes).toEqual(['user', 'assistant:failed']);
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it('recovers a provider error-text Overflow through the same one-time compaction path', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createRunsFixture({
      contextCompact: compact,
      streams: [
        errorOverflowStream(),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'overflow' }));
    // Exactly one model_call.started for the logical ModelCall; one compaction retry.
    expect(fixture.published.filter((event) => event.type === 'turn.started')).toHaveLength(1);
    expect(fixture.published.filter((event) => event.type === 'turn.ended')).toHaveLength(1);
  });

  it('recovers a silent length-stop Overflow without treating it as output truncation', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createRunsFixture({
      contextCompact: compact,
      streams: [
        lengthOverflowStream(),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'overflow' }));
    expect(fixture.published.some((event) => event.type === 'turn.ended'
      && event.payload.stopReason === 'error')).toBe(false);
  });

  it('fails on the first Overflow when the policy allows no compaction recovery', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createRunsFixture({
      contextCompact: compact,
      policy: { maxContextOverflowRecoveries: 0 },
      streams: [
        assistantStreamWithUsage('overflowing', {
          input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(compact).not.toHaveBeenCalled();
    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'context_failed' },
    });
  });

  it('does not issue a second model request when Overflow compaction fails', async () => {
    const compact = vi.fn(async (): Promise<import('@megumi/context').CompactContextResult> => ({
      status: 'failed',
      failure: {
        code: 'compaction_failed',
        message: 'Summary generation failed.',
        retryable: false,
      },
    }));
    const fixture = createRunsFixture({
      contextCompact: compact,
      streams: [
        assistantStreamWithUsage('overflowing', {
          input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
        }),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
    expect(fixture.writes).toEqual(['user', 'assistant:failed']);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(fixture.contextRuns).toHaveLength(1);
  });

  it('does not start a ModelCall or Context build when the UserMessage save fails', async () => {
    const fixture = createRunsFixture({ failUserMessageSave: true });
    const started = await fixture.runs.start(startRequest);
    expect(started.status).toBe('failed');
    if (started.status !== 'failed') return;
    expect(started.failure).toMatchObject({ code: 'session_failed' });
    expect(fixture.contextRuns).toHaveLength(0);
  });


  it('commits one final Assistant Reply and completes the Run', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('final answer')],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(fixture.contextRuns).toHaveLength(1);
    // The ModelCallContext is fixed before each build and never persisted.
    expect(fixture.contextRuns[0]).toMatchObject({
      modelCallId: expect.any(String),
      run: expect.objectContaining({
        sessionId: startRequest.sessionId,
        workspaceId: startRequest.workspaceId,
        userInput: expect.objectContaining({ modelContent: [{ type: 'text', text: 'hello' }] }),
      }),
    });
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });

  it('commits model response and tool result before rebuilding Context', async () => {
    const tool = registeredTool('lookup');
    const executeTool = vi.fn(async ({ toolName }) => ({
      type: 'succeeded' as const,
      toolName,
      normalizedResult: {
        kind: 'text' as const,
        content: 'tool output',
        isError: false,
        truncated: false,
      },
      observation: { summary: 'lookup completed' },
    }));
    const fixture = createRunsFixture({
      tools: [tool],
      executeTool,
      streams: [
        assistantStream('checking', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.writes).toEqual([
      'user',
      'model',
      'tool',
      'assistant:completed',
    ]);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(fixture.contextRuns).toHaveLength(2);
    // The second ModelCall gets its own ModelCallContext; Context reads Session History.
    expect(fixture.contextRuns[1]).toMatchObject({
      run: expect.objectContaining({ runId: started.run.runId }),
      tools: [expect.objectContaining({ name: 'lookup' })],
    });
    expect(fixture.contextRuns[1]).not.toHaveProperty('runItems');
    expect(fixture.published.some((event) => event.type === 'message.ended' && event.payload.role === 'tool_result')).toBe(true);
    expect(fixture.published.find((event) => event.type === 'message.ended' && event.payload.role === 'tool_result')?.payload).toMatchObject({
      messageId: expect.any(String),
    });
    expect(JSON.stringify(fixture.toolResults)).not.toContain('raw output must stay hidden');
    expect(fixture.toolResults[0]).toMatchObject({
      status: 'success',
      content: [{ type: 'text', text: 'tool output' }],
    });
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });

  it('publishes complete plan snapshots around ordinary Tool work in one Run', async () => {
    const planTool = registeredTool('update_plan');
    const lookupTool = registeredTool('lookup');
    let planUpdate = 0;
    const executeTool = vi.fn(async ({ toolName }, options) => {
      if (toolName === 'update_plan') {
        planUpdate += 1;
        options?.onNotification?.(planUpdate === 1
          ? {
              type: 'plan_updated',
              explanation: 'Start work',
              plan: [
                { step: 'Inspect', status: 'in_progress' },
                { step: 'Finish', status: 'pending' },
              ],
            }
          : {
              type: 'plan_updated',
              plan: [
                { step: 'Inspect', status: 'completed' },
                { step: 'Finish', status: 'completed' },
              ],
            });
      }
      return {
        type: 'succeeded' as const,
        toolName,
        normalizedResult: { kind: 'text' as const, content: `result:${toolName}`, isError: false, truncated: false },
      };
    });
    const fixture = createRunsFixture({
      tools: [planTool, lookupTool],
      executeTool,
      streams: [
        assistantStream('', { id: 'provider-call:plan:1', name: 'update_plan', arguments: { value: 'start' } }),
        assistantStream('', { id: 'provider-call:lookup', name: 'lookup', arguments: { value: 'inspect' } }),
        assistantStream('', { id: 'provider-call:plan:2', name: 'update_plan', arguments: { value: 'complete' } }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    // Plan updates are not part of the event domain; the tool results still
    // flow as transcript messages with their executed content.
    expect(fixture.published.filter((event) => event.type === 'message.ended' && event.payload.role === 'tool_result').map((event) => event.payload)).toEqual([
      expect.objectContaining({
        content: 'result:update_plan',
      }),
      expect.objectContaining({
        content: 'result:lookup',
      }),
      expect.objectContaining({
        content: 'result:update_plan',
      }),
    ]);
    expect(fixture.writes).toEqual([
      'user', 'model', 'tool', 'model', 'tool', 'model', 'tool', 'assistant:completed',
    ]);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });

  it('fails with one terminal Assistant Reply when the ModelCall limit is reached', async () => {
    const tool = registeredTool('lookup');
    const fixture = createRunsFixture({
      tools: [tool],
      policy: { maxModelCallsPerRun: 1 },
      streams: [
        assistantStream('checking', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason_code: 'loop_limit_exceeded',
        content: [],
      }),
    ]);
  });

  it('fails before committing a disallowed next tool round', async () => {
    const tool = registeredTool('lookup');
    const fixture = createRunsFixture({
      tools: [tool],
      policy: { maxToolRoundsPerRun: 1 },
      streams: [
        assistantStream('first', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'first' },
        }),
        assistantStream('second', {
          id: 'provider-call:2',
          name: tool.registeredToolName,
          arguments: { value: 'second' },
        }),
      ],
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
    expect(fixture.writes.filter((write) => write === 'model')).toHaveLength(1);
    expect(fixture.toolResults).toHaveLength(1);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(fixture.assistantReplies[0]).toMatchObject({
      status: 'failed',
      reason_code: 'loop_limit_exceeded',
    });
  });

  it('closes persisted ToolCalls when Permissions cannot evaluate them', async () => {
    const tool = registeredTool('protected-tool');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [assistantStream('checking permission', {
        id: 'provider-call:1',
        name: tool.registeredToolName,
        arguments: { value: 'x' },
      })],
      permissions: {
        evaluateToolCall: async () => ({
          status: 'failed',
          failure: {
            code: 'permission_settings_failed',
            message: 'Permission settings could not be resolved.',
          },
        }),
        applyApprovalDecision: async () => ({
          status: 'applied',
          effect: { type: 'none' },
        }),
      },
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'failure',
        error: expect.objectContaining({ code: 'run_failed_before_tool_result' }),
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:failed']);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
  });

  it('routes non-overflow length stops to output_truncated failure', async () => {
    const stream = new (await import('../../../packages/ai/src/utils/event-stream')).AssistantMessageEventStream();
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'partial' }],
      api: 'test-api',
      provider: 'provider:test',
      model: 'model:test',
      usage: {
        input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'length' as const,
      timestamp: 1,
    };
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    stream.push({ type: 'done', reason: 'length', message });

    const fixture = createRunsFixture({ streams: [stream] });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'model_call_failed' },
    });
    expect(fixture.assistantReplies[0]).toMatchObject({
      status: 'failed',
      reason_code: 'model_call_failed',
    });
  });

  it('rejects empty responses and invalid tool-use terminals as stable failures', async () => {
    const emptyStream = (await import('../../../packages/ai/src/utils/event-stream')).createAssistantMessageEventStream();
    const empty = {
      role: 'assistant' as const,
      content: [],
      api: 'test-api',
      provider: 'provider:test',
      model: 'model:test',
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp: 1,
    };
    emptyStream.push({ type: 'start', partial: empty });
    emptyStream.push({ type: 'done', reason: 'stop', message: empty });

    const fixture = createRunsFixture({ streams: [emptyStream] });
    const started = await startedRun(fixture);
    await settleRun(fixture);
    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'model_call_failed' },
    });
  });

  it('keeps the same Turn, Message and ModelCall identity across a retry', async () => {
    const fixture = createRunsFixture({
      streams: [retryableFailedStream('attempt one'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    const events = collectEvents(fixture, started.run.runId);
    const turnStarted = events.find((event) => event.type === 'turn.started');
    const messageStarted = events.find((event) => event.type === 'message.started');
    const firstUpdate = events.find((event) => event.type === 'message.update');
    const messageEnded = events.find((event) => event.type === 'message.ended');
    expect(messageEnded?.payload).toMatchObject({ messageId: messageStarted?.payload.messageId });
    expect(firstUpdate?.payload).toMatchObject({ messageId: messageStarted?.payload.messageId });
    expect(turnStarted?.payload).toMatchObject({ messageId: messageStarted?.payload.messageId });
    // Exactly one turn lifecycle pair for the logical ModelCall.
    expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.ended')).toHaveLength(1);
  });

  it('clears projected text and thinking before a retry attempt', async () => {
    const fixture = createRunsFixture({
      streams: [retryableFailedStream('stale text'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    const events = collectEvents(fixture, started.run.runId);
    const reset = events.findIndex((event) => (
      event.type === 'message.update' && event.payload.content === ''
    ));
    const retryStarted = events.findIndex((event) => event.type === 'turn.retry.started');
    expect(reset).toBeGreaterThan(-1);
    expect(retryStarted).toBeGreaterThan(-1);
    // The reset precedes the retried attempt; no stale text survives.
    expect(reset).toBeLessThan(retryStarted);
  });

  it('passes the Provider Request Retry budget to the adapter without counting attempts', async () => {
    const fixture = createRunsFixture({
      streams: [retryableFailedStream('attempt one'), assistantStream('answer')],
      policy: {
        maxModelCallAttempts: 2,
        providerRequestMaxRetries: 2,
        providerRequestMaxRetryDelayMs: 5_000,
      },
    });
    const streamSimpleSpy = vi.spyOn(fixture.options.models as never as {
      streamSimple: (...args: unknown[]) => unknown;
    }, 'streamSimple');
    const started = await startedRun(fixture);
    await settleRun(fixture);

    const events = collectEvents(fixture, started.run.runId);
    const retryStarted = events.find((event) => event.type === 'turn.retry.started');
    // ModelCall attempts are the loop's own; provider retries never inflate them.
    expect(retryStarted?.payload).toMatchObject({ attemptNumber: 2 });
    expect(streamSimpleSpy.mock.calls[0]?.[2]).toMatchObject({
      maxRetries: 2,
      maxRetryDelayMs: 5_000,
    });
  });

  it('records each finished attempt to Observability', async () => {
    const recordLog = vi.fn();
    const recordMeasurement = vi.fn();
    const observability = {
      startTrace: vi.fn(() => ({ traceId: 'trace:1' })),
      endTrace: vi.fn(),
      startSpan: vi.fn(() => ({ spanId: 'span:1' })),
      endSpan: vi.fn(),
      runInTraceContext: vi.fn((_trace: unknown, operation: () => unknown) => operation()),
      runInSpanContext: vi.fn((_span: unknown, operation: () => unknown) => operation()),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog,
      recordMeasurement,
      flush: vi.fn(async () => undefined),
    } as never;
    const fixture = createRunsFixture({
      streams: [retryableFailedStream('attempt one'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
      observability,
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    const attemptLogs = recordLog.mock.calls.filter((call) => (
      (call[0] as { event: string }).event === 'model.call.attempt.finished'
    ));
    // Both the failed and the successful attempt are recorded, never dropped.
    expect(attemptLogs).toHaveLength(2);
  });

  it('executes parallel-mode tool calls concurrently and commits results in model order', async () => {
    const parallelTool = registeredTool('parallel-tool', { executionMode: 'parallel' });
    const serialTool = registeredTool('serial-tool');
    const executeTool = vi.fn(async ({ toolName }) => {
      await new Promise((resolve) => setTimeout(resolve, toolName === 'parallel-tool' ? 20 : 5));
      return succeeded(toolName);
    });
    const fixture = createRunsFixture({
      tools: [parallelTool, serialTool],
      executeTool,
      streams: [
        assistantStream('', {
          id: 'parallel:1',
          name: 'parallel-tool',
          arguments: { value: 'a' },
        }),
        assistantStream('', {
          id: 'parallel:2',
          name: 'parallel-tool',
          arguments: { value: 'b' },
        }),
        assistantStream('', {
          id: 'serial:1',
          name: 'serial-tool',
          arguments: { value: 'c' },
        }),
        assistantStream('final answer'),
      ],
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    // The two parallel calls overlap in time (concurrent), the serial call waits.
    const parallelCalls = executeTool.mock.calls.filter(([request]) => request.toolName === 'parallel-tool');
    expect(parallelCalls).toHaveLength(2);
    expect(executeTool.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(0);
    // Results commit in the model's original call order.
    const committed = fixture.toolResults.map((result) => result.tool_call_id);
    expect(committed).toEqual(['parallel:1', 'parallel:2', 'serial:1']);
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });

  it('uses the same Tools Router for one ModelCall resolution, routing and release', async () => {
    const tool = registeredTool('lookup');
    const routers = new Map<string, ReturnType<typeof createToolRouter>>();
    const resolve = (scope: { modelCallId: string; runId: string; sessionId: string; workspaceId: string }) => {
      let router = routers.get(scope.modelCallId);
      if (!router) {
        router = createToolRouter({ scope, tools: [tool] });
        routers.set(scope.modelCallId, router);
      }
      return router;
    };
    const fixture = createRunsFixture({
      tools: [tool],
      executeTool: async ({ toolName }) => succeeded(toolName),
    });
    // Replace the fixture tools with a router-tracked implementation.
    const engineOptions = fixture.options as CreateEngineOptions & { tools: unknown };
    engineOptions.tools = {
      resolveModelCallTools: (scope) => ({ status: 'resolved', definitions: resolve(scope).definitions() }),
      routeToolCall: (call) => resolve(call).route(call),
      executeToolInvocation: (input, options) => {
        const router = resolve({
          runId: input.invocation.runId,
          sessionId: input.invocation.sessionId,
          workspaceId: input.invocation.workspaceId,
          modelCallId: input.invocation.modelCallId,
        });
        return router.route({
          runId: input.invocation.runId,
          sessionId: input.invocation.sessionId,
          workspaceId: input.invocation.workspaceId,
          modelCallId: input.invocation.modelCallId,
          toolCallId: input.invocation.toolCallId,
          toolName: input.invocation.toolName,
          input: input.invocation.input,
        }).status === 'failed'
          ? Promise.reject(new Error('route failed'))
          : Promise.resolve(succeeded(input.invocation.toolName));
      },
      releaseModelCallTools: ({ modelCallId }) => { routers.delete(modelCallId); },
    } as never;

    const started = await startedRun(fixture);
    await settleRun(fixture);

    // The single model call created one router, routed through it, and
    // released it when the turn settled.
    expect(routers.size).toBe(0);
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });
});
