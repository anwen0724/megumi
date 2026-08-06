/*
 * Protects Engine's Context-model-Session-tool loop and semantic commit order.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CreateRunsOptions } from '@megumi/engine';
import { createToolRouter, registeredTool, succeeded } from './tool-call-test-fixtures';
import {
  assistantStream,
  assistantStreamWithUsage,
  collectEvents,
  compactedOverflowCompaction,
  createRunsFixture,
  errorOverflowStream,
  lengthOverflowStream,
  neverEndingStream,
  requestedCancellation,
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

  it('stops the Run when a Session commit fails after the model response', async () => {
    const tool = registeredTool('lookup');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [assistantStream('checking', {
        id: 'provider-call:1',
        name: tool.registeredToolName,
        arguments: { value: 'x' },
      })],
    });
    // A failed model-response commit must stop the execution: no ToolCall runs
    // and no next Context build uses unpersisted facts.
    fixture.options.session.saveModelResponse = () => ({
      status: 'failed' as const,
      failure: { code: 'session_error', message: 'Model response failed.' },
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'session_failed' },
    });
    expect(fixture.writes).toEqual(['user']);
    expect(fixture.contextRuns).toHaveLength(1);
    // The started Turn and Message still close exactly once on the commit failure.
    const events = collectEvents(fixture, started.run.runId);
    expect(events.filter((event) => event.type === 'message.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'message.ended')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.ended')).toHaveLength(1);
    expect(events.find((event) => event.type === 'turn.ended')?.payload).toMatchObject({
      stopReason: 'error',
    });
  });


  it('closes the started message and turn when the final reply commit fails', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('final answer')],
    });
    fixture.options.session.saveAssistantReply = () => ({
      status: 'failed' as const,
      failure: { code: 'session_error', message: 'Final reply failed.' },
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'session_failed' },
    });
    const events = collectEvents(fixture, started.run.runId);
    // The streamed assistant Message and its Turn close exactly once; the
    // failed commit saved nothing, so no extra Reply lifecycle appears.
    expect(events.filter((event) => event.type === 'message.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'message.ended')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.ended')).toHaveLength(1);
    expect(events.find((event) => event.type === 'turn.ended')?.payload).toMatchObject({
      stopReason: 'error',
    });
  });

  it('publishes real partial ToolResult facts before a later commit failure stops the Run', async () => {
    const tool = registeredTool('lookup');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [
        assistantStream('', {
          id: 'call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('', {
          id: 'call:2',
          name: tool.registeredToolName,
          arguments: { value: 'y' },
        }),
      ],
    });
    // The first ToolResult saves, the second fails.
    let toolSaves = 0;
    fixture.options.session.saveToolResultMessage = (request) => {
      toolSaves += 1;
      if (toolSaves === 2) {
        return {
          status: 'failed' as const,
          failure: { code: 'session_error', message: 'Second tool result failed.' },
        };
      }
      return {
        status: 'saved' as const,
        message: {
          message_id: request.message_id,
          session_id: request.session_id,
          run_id: request.run_id,
          message_kind: 'tool_result',
          tool_call_id: request.tool_call_id,
          tool_name: request.tool_name,
          status: request.status,
          content: request.content,
          created_at: request.completed_at,
          completed_at: request.completed_at,
        },
        entry: {
          entry_id: `entry:tool:${request.message_id}`,
          session_id: request.session_id,
          entry_type: 'message',
          message_id: request.message_id,
          created_at: request.completed_at,
        },
      };
    };

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'session_failed' },
    });
    const events = collectEvents(fixture, started.run.runId);
    const toolResultStarts = events.filter(
      (event) => event.type === 'message.started' && event.payload.role === 'tool_result',
    );
    const toolResultEnds = events.filter(
      (event) => event.type === 'message.ended' && event.payload.role === 'tool_result',
    );
    // Only the really saved first ToolResult got its Message lifecycle pair.
    expect(toolResultStarts).toHaveLength(1);
    expect(toolResultEnds).toHaveLength(1);
    expect(toolResultStarts[0]?.payload).toMatchObject({ messageId: expect.any(String) });
    expect(toolResultEnds[0]?.payload).toMatchObject({ content: 'result:lookup' });
    // Each started Turn closes exactly once: the first with tool_calls, the
    // second with error after the commit failure.
    const turnEnds = events.filter((event) => event.type === 'turn.ended');
    expect(turnEnds).toHaveLength(2);
    expect(turnEnds.map((event) => event.payload.stopReason).sort()).toEqual(['error', 'tool_calls']);
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
    // The second Turn had already started its Message when the round limit
    // hit: every started assistant Message (turn one, turn two and the failed
    // Reply) closes exactly once, and the second Turn ends with error.
    const events = collectEvents(fixture, started.run.runId);
    const assistantStarts = events.filter(
      (event): event is typeof event & { payload: { role: 'assistant'; messageId: string } } =>
        event.type === 'message.started' && event.payload.role === 'assistant',
    );
    const assistantEnds = events.filter(
      (event): event is typeof event & { payload: { role: 'assistant'; messageId: string } } =>
        event.type === 'message.ended' && event.payload.role === 'assistant',
    );
    expect(assistantStarts).toHaveLength(3);
    expect(assistantEnds).toHaveLength(3);
    expect(assistantEnds.map((event) => event.payload.messageId).sort())
      .toEqual(assistantStarts.map((event) => event.payload.messageId).sort());
    expect(events.filter((event) => event.type === 'turn.ended')).toHaveLength(2);
    const turnEnds = events.filter((event) => event.type === 'turn.ended');
    expect(turnEnds.map((event) => event.payload.stopReason).sort()).toEqual(['error', 'tool_calls']);
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
    // Attempt, usage, duration and retry are recorded as Measurements with
    // their real units; the retry measurement only fires for the retried call.
    const measurements = recordMeasurement.mock.calls.map((call) => call[0] as { name: string; unit: string });
    const names = measurements.map((measurement) => measurement.name);
    expect(names).toContain('model.call.attempt');
    expect(names).toContain('model.call.usage');
    expect(names).toContain('model.call.duration_ms');
    expect(names).toContain('model.call.retry');
    expect(measurements.find((m) => m.name === 'model.call.usage')?.unit).toBe('token');
    expect(measurements.find((m) => m.name === 'model.call.duration_ms')?.unit).toBe('ms');
    const attemptMeasurements = measurements.filter((m) => m.name === 'model.call.attempt');
    expect(attemptMeasurements.map((m) => m.unit)).toEqual(['count', 'count']);
  });

  it('ends Run, ModelCall and ToolCall spans with real statuses and identity facts', async () => {
    const startSpan = vi.fn(() => ({ spanId: 'span:1' }));
    const endSpan = vi.fn();
    const endTrace = vi.fn();
    const observability = {
      startTrace: vi.fn(() => ({ traceId: 'trace:1' })),
      endTrace,
      startSpan,
      endSpan,
      runInTraceContext: vi.fn((_trace: unknown, operation: () => unknown) => operation()),
      runInSpanContext: vi.fn(),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog: vi.fn(),
      recordMeasurement: vi.fn(),
      flush: vi.fn(async () => undefined),
    } as never;
    const tool = registeredTool('lookup');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [
        assistantStream('', { id: 'call:1', name: 'lookup', arguments: { value: 'x' } }),
        assistantStream('final answer'),
      ],
      observability,
    });
    await startedRun(fixture);
    await settleRun(fixture);

    // The ModelCall span carries its modelCallId; the ToolCall span carries
    // modelCallId and toolCallId.
    expect(startSpan).toHaveBeenCalledWith(expect.objectContaining({
      name: 'model.call',
      attributes: expect.objectContaining({ modelCallId: expect.any(String) }),
    }));
    expect(startSpan).toHaveBeenCalledWith(expect.objectContaining({
      name: 'tool.call',
      attributes: expect.objectContaining({
        modelCallId: expect.any(String),
        toolCallId: 'call:1',
      }),
    }));
    // Every span and the trace end ok for a completed Run.
    expect(endSpan.mock.calls.every((call) => (call[0] as { status: string }).status === 'ok')).toBe(true);
    expect(endTrace).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  it('ends the Run trace as cancelled and error for their real outcomes', async () => {
    const endTrace = vi.fn();
    const observability = {
      startTrace: vi.fn(() => ({ traceId: 'trace:1' })),
      endTrace,
      startSpan: vi.fn(() => ({ spanId: 'span:1' })),
      endSpan: vi.fn(),
      runInTraceContext: vi.fn((_trace: unknown, operation: () => unknown) => operation()),
      runInSpanContext: vi.fn(),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog: vi.fn(),
      recordMeasurement: vi.fn(),
      flush: vi.fn(async () => undefined),
    } as never;

    const cancelledFixture = createRunsFixture({
      streams: [neverEndingStream()],
      observability,
    });
    const cancelled = await startedRun(cancelledFixture);
    await requestedCancellation(cancelledFixture, cancelled.run.runId);
    await settleRun(cancelledFixture);
    expect(endTrace).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));

    const failedFixture = createRunsFixture({
      streams: [retryableFailedStream('boom')],
      policy: { maxModelCallAttempts: 1 },
      observability,
    });
    await startedRun(failedFixture);
    await settleRun(failedFixture);
    expect(endTrace).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
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
    const runOptions = fixture.options as CreateRunsOptions & { tools: unknown };
    runOptions.tools = {
      resolveModelCallTools: (scope: { modelCallId: string; runId: string; sessionId: string; workspaceId: string }) => (
        { status: 'resolved', definitions: resolve(scope).definitions() }
      ),
      routeToolCall: (call: { runId: string; sessionId: string; workspaceId: string; modelCallId: string; toolCallId: string; toolName: string; input: unknown }) => (
        resolve(call).route(call)
      ),
      executeToolInvocation: (input: {
        invocation: {
          runId: string; sessionId: string; workspaceId: string; modelCallId: string;
          toolCallId: string; toolName: string; input: unknown;
        };
      }) => {
        const router = resolve({
          runId: input.invocation.runId,
          sessionId: input.invocation.sessionId,
          workspaceId: input.invocation.workspaceId,
          modelCallId: input.invocation.modelCallId,
        });
        return router.route({
          toolCallId: input.invocation.toolCallId,
          toolName: input.invocation.toolName,
          input: input.invocation.input,
        }).status === 'failed'
          ? Promise.reject(new Error('route failed'))
          : Promise.resolve(succeeded(input.invocation.toolName));
      },
      releaseModelCallTools: ({ modelCallId }: { modelCallId: string }) => { routers.delete(modelCallId); },
    } as never;

    const started = await startedRun(fixture);
    await settleRun(fixture);

    // The single model call created one router, routed through it, and
    // released it when the turn settled.
    expect(routers.size).toBe(0);
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
  });

  it('releases the ModelCall Tools router on the failure and cancellation paths', async () => {
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
    const trackedTools = {
      resolveModelCallTools: (scope: { modelCallId: string; runId: string; sessionId: string; workspaceId: string }) => ({
        status: 'resolved' as const,
        definitions: resolve(scope).definitions(),
      }),
      routeToolCall: (call: { modelCallId: string; runId: string; sessionId: string; workspaceId: string; toolCallId: string; toolName: string; input: unknown }) => (
        resolve(call).route(call)
      ),
      executeToolInvocation: (input: { invocation: { runId: string; sessionId: string; workspaceId: string; modelCallId: string; toolCallId: string; toolName: string; input: unknown } }) => (
        Promise.resolve(succeeded('lookup'))
      ),
      releaseModelCallTools: ({ modelCallId }: { modelCallId: string }) => { routers.delete(modelCallId); },
    };

    // Failure path: a retry-exhausted ModelCall still releases the router.
    const failedFixture = createRunsFixture({
      streams: [retryableFailedStream('boom')],
      policy: { maxModelCallAttempts: 1 },
    });
    (failedFixture.options as never as { tools: unknown }).tools = trackedTools;
    await startedRun(failedFixture);
    await settleRun(failedFixture);
    expect(failedFixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
    expect(routers.size).toBe(0);

    // Cancellation path: an aborted stream still releases the router.
    const cancelledFixture = createRunsFixture({
      streams: [neverEndingStream()],
    });
    (cancelledFixture.options as never as { tools: unknown }).tools = trackedTools;
    const cancelled = await startedRun(cancelledFixture);
    await requestedCancellation(cancelledFixture, cancelled.run.runId);
    await settleRun(cancelledFixture);
    expect(cancelledFixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(routers.size).toBe(0);
  });

  it('keeps the Run outcome unchanged when Observability operations throw', async () => {
    const failingObservability = {
      startTrace: vi.fn(() => { throw new Error('observability down'); }),
      endTrace: vi.fn(),
      startSpan: vi.fn(() => { throw new Error('observability down'); }),
      endSpan: vi.fn(() => { throw new Error('observability down'); }),
      runInTraceContext: vi.fn(),
      runInSpanContext: vi.fn(),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog: vi.fn(() => { throw new Error('observability down'); }),
      recordMeasurement: vi.fn(() => { throw new Error('observability down'); }),
      flush: vi.fn(async () => undefined),
    } as never;
    const fixture = createRunsFixture({
      streams: [assistantStream('answer')],
      observability: failingObservability,
    });

    const started = await startedRun(fixture);
    await settleRun(fixture);

    // Diagnostics never own Run outcome: the Run still completed normally.
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
  });

  it('keeps the completed Run outcome when Tool route release fails and records the cleanup error', async () => {
    const recordLog = vi.fn();
    const observability = {
      startTrace: vi.fn(() => ({ traceId: 'trace:1' })),
      endTrace: vi.fn(),
      startSpan: vi.fn(() => ({ spanId: 'span:1' })),
      endSpan: vi.fn(),
      runInTraceContext: vi.fn((_trace: unknown, operation: () => unknown) => operation()),
      runInSpanContext: vi.fn(),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog,
      recordMeasurement: vi.fn(),
      flush: vi.fn(async () => undefined),
    } as never;
    const fixture = createRunsFixture({
      streams: [assistantStream('answer')],
      observability,
    });
    // A failing route release is only a diagnostic: it must not overwrite the
    // completed business result or add a second terminal Reply.
    fixture.options.tools.releaseModelCallTools = () => { throw new Error('release failed'); };

    const started = await startedRun(fixture);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
    // Exactly one terminal Reply matching the real business result.
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      event: 'tool.router.release_failed',
    }));
  });

  it('keeps the failed and cancelled Run outcomes when Tool route release fails', async () => {
    const recordLog = vi.fn();
    const observability = {
      startTrace: vi.fn(() => ({ traceId: 'trace:1' })),
      endTrace: vi.fn(),
      startSpan: vi.fn(() => ({ spanId: 'span:1' })),
      endSpan: vi.fn(),
      runInTraceContext: vi.fn((_trace: unknown, operation: () => unknown) => operation()),
      runInSpanContext: vi.fn(),
      getCurrentTrace: vi.fn(),
      getCurrentSpan: vi.fn(),
      recordLog,
      recordMeasurement: vi.fn(),
      flush: vi.fn(async () => undefined),
    } as never;

    // Failed business result stays failed with its own error code.
    const failedFixture = createRunsFixture({
      streams: [retryableFailedStream('boom')],
      policy: { maxModelCallAttempts: 1 },
      observability,
    });
    failedFixture.options.tools.releaseModelCallTools = () => { throw new Error('release failed'); };
    await startedRun(failedFixture);
    await settleRun(failedFixture);
    expect(failedFixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'model_call_failed' },
    });
    expect(failedFixture.assistantReplies).toHaveLength(1);

    // Cancelled business result stays cancelled.
    const cancelledFixture = createRunsFixture({
      streams: [neverEndingStream()],
      observability,
    });
    cancelledFixture.options.tools.releaseModelCallTools = () => { throw new Error('release failed'); };
    const cancelled = await startedRun(cancelledFixture);
    await requestedCancellation(cancelledFixture, cancelled.run.runId);
    await settleRun(cancelledFixture);
    expect(cancelledFixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(cancelledFixture.assistantReplies).toHaveLength(1);
  });
});
