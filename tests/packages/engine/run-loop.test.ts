/*
 * Protects Engine's Context-model-Session-tool loop and semantic commit order.
 */
import { describe, expect, it, vi } from 'vitest';
import { registeredTool } from './tool-call-test-fixtures';
import {
  assistantStream,
  assistantStreamWithUsage,
  collectEvents,
  compactedOverflowCompaction,
  createEngineFixture,
  errorOverflowStream,
  lengthOverflowStream,
  startedRun,
  startRequest,
} from './engine-test-fixtures';

describe('Engine run loop', () => {
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
    const events = await collectEvents(started.events);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(events.map((event) => event.eventType)).toContain('model_call.projection_reset');
    expect(events.at(-1)?.eventType).toBe('run.completed');
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
    const events = await collectEvents(started.events);

    expect(events.at(-1)?.eventType).toBe('run.failed');
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
    const events = await collectEvents(started.events);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(events.at(-1)?.eventType).toBe('run.completed');
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'overflow' }));
    // Exactly one model_call.started for the logical ModelCall; one compaction retry.
    expect(events.filter((event) => event.eventType === 'model_call.started')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'model_call.completed')).toHaveLength(1);
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
    const events = await collectEvents(started.events);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(events.at(-1)?.eventType).toBe('run.completed');
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'overflow' }));
    expect(events.some((event) => event.eventType === 'model_call.completed'
      && event.payload.finishReason === 'failed')).toBe(false);
  });

  it('does not issue a second model request when Overflow compaction fails', async () => {
    const compact = vi.fn(async () => ({
      status: 'failed' as const,
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
    const events = await collectEvents(started.events);

    expect(events.at(-1)?.eventType).toBe('run.failed');
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
    expect(fixture.skillViewRequests).toHaveLength(0);
  });

  it('creates one immutable SkillView per ModelCall with only Workspace and signal facts', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('final answer')],
    });

    const started = await startedRun(fixture);
    await collectEvents(started.events);

    // createView receives only the Workspace identity and the Run signal; no selection facts.
    expect(fixture.skillViewRequests).toHaveLength(1);
    expect(fixture.skillViewRequests[0]).toEqual({
      workspaceId: startRequest.workspaceId,
      signal: expect.any(AbortSignal),
    });
    expect(fixture.skillViewRequests[0]).not.toHaveProperty('skillSelection');
  });


  it('commits one final Assistant Reply and completes the Run', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('final answer')],
    });

    const started = await startedRun(fixture);
    const events = await collectEvents(started.events);

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
    expect(events.at(-1)?.eventType).toBe('run.completed');
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
    const events = await collectEvents(started.events);

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
      tools: { definitions: [expect.objectContaining({ name: 'lookup' })] },
    });
    expect(fixture.contextRuns[1]).not.toHaveProperty('runItems');
    expect(events.map((event) => event.eventType)).toContain('tool_result.created');
    expect(events.find((event) => event.eventType === 'tool_result.created')?.payload).toMatchObject({
      summary: 'lookup completed',
    });
    expect(JSON.stringify(fixture.toolResults)).not.toContain('raw output must stay hidden');
    expect(fixture.toolResults[0]).toMatchObject({
      status: 'success',
      content: [{ type: 'text', text: 'tool output' }],
    });
    expect(events.at(-1)?.eventType).toBe('run.completed');
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
    const events = await collectEvents(started.events);

    expect(events.filter((event) => event.eventType === 'run.plan.updated').map((event) => event.payload)).toEqual([
      expect.objectContaining({
        toolCallId: 'provider-call:plan:1',
        explanation: 'Start work',
        plan: [
          { step: 'Inspect', status: 'in_progress' },
          { step: 'Finish', status: 'pending' },
        ],
      }),
      expect.objectContaining({
        toolCallId: 'provider-call:plan:2',
        plan: [
          { step: 'Inspect', status: 'completed' },
          { step: 'Finish', status: 'completed' },
        ],
      }),
    ]);
    expect(fixture.writes).toEqual([
      'user', 'model', 'tool', 'model', 'tool', 'model', 'tool', 'assistant:completed',
    ]);
    expect(events.at(-1)?.eventType).toBe('run.completed');
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
    const events = await collectEvents(started.events);

    expect(events.at(-1)?.eventType).toBe('run.failed');
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
    const events = await collectEvents(started.events);

    expect(events.at(-1)?.eventType).toBe('run.failed');
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
    const events = await collectEvents(started.events);

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'failure',
        error: expect.objectContaining({ code: 'run_failed_before_tool_result' }),
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:failed']);
    expect(events.at(-1)?.eventType).toBe('run.failed');
  });
});
