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
  createEngineFixture,
  errorOverflowStream,
  lengthOverflowStream,
  settleRun,
  startedRun,
  startRequest,
} from './engine-test-fixtures';

describe('Agent Loop', () => {
  it('recovers from one Context Overflow per ModelCall with a compaction retry', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createEngineFixture({
      contextCompact: compact,
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
    }));
    // The rebuilt Prompt came from the same ModelCallContext; the run completed once.
    expect(fixture.contextRuns).toHaveLength(2);
  });

  it('does not retry a second Overflow on the same ModelCall', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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

  it('does not issue a second model request when Overflow compaction fails', async () => {
    const compact = vi.fn(async (): Promise<import('@megumi/context').CompactContextResult> => ({
      status: 'failed',
      failure: {
        code: 'compaction_failed',
        message: 'Summary generation failed.',
        retryable: false,
      },
    }));
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({ failUserMessageSave: true });
    const started = await fixture.engine.startRun(startRequest);
    expect(started.status).toBe('failed');
    if (started.status !== 'failed') return;
    expect(started.failure).toMatchObject({ code: 'session_failed' });
    expect(fixture.contextRuns).toHaveLength(0);
  });


  it('commits one final Assistant Reply and completes the Run', async () => {
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
    const fixture = createEngineFixture({
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
