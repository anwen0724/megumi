/*
 * Protects Engine's Context-model-Session-tool loop and semantic commit order.
 */
import { describe, expect, it, vi } from 'vitest';
import { registeredTool } from './tool-call-test-fixtures';
import {
  assistantStream,
  collectEvents,
  createEngineFixture,
  startRequest,
} from './engine-test-fixtures';

describe('Engine run loop', () => {  it('creates one immutable SkillView per ModelCall with only Workspace and signal facts', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('final answer')],
    });

    const started = await fixture.engine.startRun(startRequest);
    expect(started.status).toBe('started');
    if (started.status !== 'started') throw new Error('Expected started Run.');
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

    const started = await fixture.engine.startRun(startRequest);
    expect(started.status).toBe('started');
    if (started.status !== 'started') throw new Error('Expected started Run.');

    const events = await collectEvents(started.events);

    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(fixture.contextRuns).toHaveLength(1);
    expect(fixture.contextUsageRecords).toEqual([
      expect.objectContaining({
        sessionId: startRequest.sessionId,
        runId: started.run.runId,
        preCallUsage: expect.objectContaining({ contextWindowTokens: 4_096 }),
      }),
    ]);
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    const events = await collectEvents(started.events);

    expect(fixture.writes).toEqual([
      'user',
      'model',
      'tool',
      'assistant:completed',
    ]);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(fixture.contextRuns).toHaveLength(2);
    expect(fixture.contextRuns[1]).toMatchObject({
      runItems: [
        { type: 'assistant_message' },
        { type: 'tool_call', toolName: 'lookup' },
        {
          type: 'tool_result',
          toolName: 'lookup',
        },
      ],
    });
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
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
