/*
 * Protects the Execute Agent boundary: Agent construction, Session settlement,
 * approval waits inside the original ToolCall Promise, and outcome mapping.
 */
import {
  launchAgentExecution,
  type ExecuteAgentDependencies,
} from '@megumi/execution';
import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '@megumi/events';
import type { PermissionDecision } from '@megumi/permissions';
import type { SessionHistory } from '@megumi/session';
import {
  assistantStream,
  collectEvents,
  compactedOverflowCompaction,
  createExecutionFixture,
  errorOverflowStream,
  executionMetadata,
  launchedExecution,
  neverEndingStream,
  partialThinkingStream,
  retryableFailedStream,
  type ExecutionFixture,
} from './execution-test-fixtures';
import { permissionService, registeredTool } from './tool-call-test-fixtures';

const NOW = '2026-07-31T00:00:00.000Z';

describe('Execute Agent', () => {
  it('persists a Recommendation reference and presents it to the first model call', async () => {
    const fixture = createExecutionFixture({ streams: [assistantStream('done')] });
    const launched = await launchAgentExecution({
      metadata: executionMetadata(),
      input: {
        displayContent: [{ type: 'text', text: '聊聊它的架构' }],
        modelContent: [{ type: 'text', text: '聊聊它的架构' }],
        attachments: [],
      },
      recommendationReference: {
        type: 'recommendation_reference', recommendationId: 'recommendation:1', sourceName: 'GitHub',
        canonicalUrl: 'https://example.com/agent', title: 'Agent runtime',
        description: 'A concrete implementation.', recommendationReason: 'Relevant to your interests.',
      },
      awaitApproval: async () => ({ status: 'cancelled' as const }),
    }, fixture.dependencies);

    expect(fixture.userMessages[0]?.display_content).toEqual([
      expect.objectContaining({ type: 'recommendation_reference', recommendationId: 'recommendation:1' }),
      { type: 'text', text: '聊聊它的架构' },
    ]);
    expect(fixture.userMessages[0]?.model_content).toEqual(fixture.userMessages[0]?.display_content);
    expect(launched.agent.state.messages[0]?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('<recommended_content') }),
      { type: 'text', text: '聊聊它的架构' },
    ]);
  });
  it('uses the Discovery Agent executionId for the Agent state and result', async () => {
    const fixture = createExecutionFixture({ streams: [neverEndingStream()] });
    const launched = await launchedExecution(fixture, {
      metadata: { executionId: 'execution:shared' },
    });
    let resultExecutionId: string | undefined;
    launched.agent.subscribe((event) => {
      if (event.type === 'agent_end') resultExecutionId = event.result.executionId;
    });

    const execution = launched.execute();
    await vi.waitFor(() => {
      expect(launched.agent.state.execution).toMatchObject({
        status: 'executing',
        executionId: 'execution:shared',
      });
    });
    launched.agent.abort();

    await expect(execution).resolves.toEqual({ status: 'cancelled' });
    expect(resultExecutionId).toBe('execution:shared');
  });

  it('continues from the already committed User Entry and commits one final reply', async () => {
    const fixture = createExecutionFixture({ streams: [assistantStream('done')] });
    const released: string[] = [];
    const modelContexts: unknown[] = [];
    const dependencies = dependenciesFrom(fixture, {
      models: captureModelContexts(fixture.dependencies.models, modelContexts),
      tools: captureReleases(fixture.dependencies.tools, released),
    });

    const launched = await launchWith(fixture, dependencies);
    const outcome = await launched.execute();

    expect(outcome).toEqual({ status: 'completed', assistantMessageId: 'message:1' });
    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(fixture.assistantReplies[0]).toMatchObject({
      parent_entry_id: 'entry:1',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
    });
    expect(modelContexts).toHaveLength(1);
    expect(released).toEqual(['model-call:1']);
  });

  it('commits each tool Turn before the next Context scope and preserves the Session Entry chain', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('using tool', { id: 'call:1', name: 'lookup', arguments: { value: 'x' } }),
        assistantStream('final answer'),
      ],
      tools: [registeredTool('lookup')],
    });
    const released: string[] = [];
    const dependencies = dependenciesFrom(fixture, {
      tools: captureReleases(fixture.dependencies.tools, released),
    });
    const launched = await launchWith(fixture, dependencies);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.writes).toEqual(['user', 'model', 'tool', 'assistant:completed']);
    expect(fixture.contextRuns).toHaveLength(2);
    expect(released).toEqual(['model-call:1', 'model-call:2']);
    expect(fixture.toolResults).toHaveLength(1);
    expect(fixture.toolResults[0]).toMatchObject({
      parent_entry_id: 'entry:2',
      tool_call_id: 'call:1',
      tool_name: 'lookup',
      status: 'success',
    });
    expect(fixture.assistantReplies[0]).toMatchObject({
      parent_entry_id: 'entry:3',
      status: 'completed',
    });
  });

  it('releases the Tool scope and records one failed reply when Context building fails', async () => {
    const fixture = createExecutionFixture({
      contextBuild: async () => ({
        status: 'failed',
        failure: {
          code: 'context_build_failed',
          message: 'Context is unavailable.',
          retryable: false,
          cause: { owner: 'context', code: 'source_unavailable' },
        },
      }),
    });
    const released: string[] = [];
    const dependencies = dependenciesFrom(fixture, {
      tools: captureReleases(fixture.dependencies.tools, released),
    });
    const launched = await launchWith(fixture, dependencies);
    const outcome = await launched.execute();

    expect(outcome).toEqual({
      status: 'failed',
      failure: {
        code: 'context_failed',
        message: 'Context is unavailable.',
        retryable: false,
        cause: { owner: 'context', code: 'source_unavailable' },
      },
    });
    expect(fixture.writes).toEqual(['user', 'assistant:failed']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(released).toEqual(['model-call:1']);
  });

  it('keeps Session commit failure owned by Session without claiming a terminal reply was persisted', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('using tool', { id: 'call:1', name: 'lookup', arguments: {} }),
      ],
      tools: [registeredTool('lookup')],
    });
    const saveAssistantReply = vi.fn(fixture.dependencies.session.saveAssistantReply);
    const session: Pick<SessionHistory, 'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'> = {
      ...fixture.dependencies.session,
      saveModelResponse: vi.fn(async () => ({
        status: 'failed' as const,
        failure: { code: 'session_error', message: 'Model response save failed.' },
      })),
      saveToolResultMessage: fixture.dependencies.session.saveToolResultMessage,
      saveAssistantReply,
    };
    const overridden = dependenciesFrom(fixture, { session });
    const launched = await launchWith(fixture, overridden);
    const outcome = await launched.execute();

    expect(outcome).toEqual({
      status: 'failed',
      failure: {
        code: 'session_failed',
        message: 'Model response save failed.',
        retryable: false,
        cause: { owner: 'session', code: 'session_failed' },
      },
    });
    expect(saveAssistantReply).not.toHaveBeenCalled();
  });

  it('aborts through the Agent root signal and persists one cancelled reply', async () => {
    const fixture = createExecutionFixture({ streams: [neverEndingStream()] });
    const launched = await launchedExecution(fixture);

    const execution = launched.execute();
    // The outer layer only calls agent.abort(); there is no second root controller.
    launched.agent.abort();
    const outcome = await execution;

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(fixture.writes).toEqual(['user', 'assistant:cancelled']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(fixture.assistantReplies[0]).toMatchObject({
      status: 'cancelled',
      reason_code: 'user_cancelled',
    });
  });

  it('preserves partial thinking and text in the one cancelled reply', async () => {
    const fixture = createExecutionFixture({
      streams: [partialThinkingStream('ponder xyz', 'partial answer')],
    });
    const launched = await launchedExecution(fixture);

    const execution = launched.execute();
    await vi.waitFor(() => {
      expect(launched.agent.state.streamingMessage?.content).toEqual([
        { type: 'thinking', thinking: 'ponder xyz' },
        { type: 'text', text: 'partial answer' },
      ]);
    });
    launched.agent.abort();
    await execution;

    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        reason_code: 'user_cancelled',
        content: [
          { type: 'thinking', thinking: 'ponder xyz' },
          { type: 'text', text: 'partial answer' },
        ],
      }),
    ]);
    const messageEnded = fixture.published.find(
      (event) => event.type === 'message.ended' && event.payload.role === 'assistant',
    );
    expect(messageEnded?.payload).toMatchObject({ content: 'partial answer' });
  });

  it('commits a cancelled ToolResult before the one cancelled reply', async () => {
    const tool = registeredTool('slow-tool');
    const executeTool = vi.fn(async (
      request: { readonly toolName: string },
      options?: { readonly signal?: AbortSignal },
    ) => {
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        type: 'failed' as const,
        toolName: request.toolName,
        error: { code: 'tool_cancelled', message: 'cancelled' },
        normalizedResult: {
          kind: 'text' as const,
          content: 'cancelled',
          isError: true,
          truncated: false,
        },
      };
    });
    const fixture = createExecutionFixture({
      tools: [tool],
      executeTool,
      streams: [assistantStream('using tool', {
        id: 'provider-call:1',
        name: tool.registeredToolName,
        arguments: { value: 'x' },
      })],
    });
    const launched = await launchedExecution(fixture);

    const execution = launched.execute();
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledOnce());
    launched.agent.abort();
    await execution;

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        tool_name: 'slow-tool',
        status: 'cancelled',
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:cancelled']);
  });

  it('keeps permission denial model-visible so the Agent can continue to a final answer', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('try tool', { id: 'call:1', name: 'protected', arguments: {} }),
        assistantStream('I cannot use that tool.'),
      ],
      tools: [registeredTool('protected')],
      permissions: permissionService((request): PermissionDecision => ({
        type: 'deny',
        operations: [...request.operations],
        safetyAssessment: 'prohibited',
        safetySummary: 'Denied.',
        reason: 'Denied in test.',
        denialCode: 'rule_denied',
      })),
    });
    const launched = await launchedExecution(fixture);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.writes).toEqual(['user', 'model', 'tool', 'assistant:completed']);
    expect(fixture.toolResults[0]).toMatchObject({
      status: 'permission_denied',
      error: { code: 'rule_denied', message: 'Denied in test.' },
    });
  });

  it('awaits the approval decision inside the original ToolCall Promise and then executes', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('approve tool', { id: 'call:1', name: 'protected', arguments: {} }),
        assistantStream('approved result'),
      ],
      tools: [registeredTool('protected')],
      permissions: permissionService(approvalDecisionFor),
    });
    const awaitApproval = vi.fn(async ({ approval }: Parameters<Parameters<typeof launchedExecution>[1]['awaitApproval']>[0]) => ({
      status: 'approved' as const,
      decision: {
        approvalRequestId: approval.approvalId,
        decision: 'approved' as const,
        optionId: approval.defaultOptionId,
        decidedBy: 'user' as const,
        decidedAt: NOW,
      },
    }));
    const launched = await launchedExecution(fixture, { awaitApproval });
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(awaitApproval).toHaveBeenCalledOnce();
    expect(awaitApproval.mock.calls[0]?.[0]).toMatchObject({
      approval: {
        executionId: 'execution:1',
        toolCallId: 'call:1',
        toolName: 'protected',
        status: 'pending',
      },
    });
    expect(fixture.toolResults[0]?.status).toBe('success');
    expect(fixture.published.map((event) => event.type)).toEqual(expect.arrayContaining([
      'approval.requested',
      'approval.resolved',
    ]));
  });

  it('settles a denied approval as a model-visible rejection', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('approve tool', { id: 'call:1', name: 'protected', arguments: {} }),
        assistantStream('rejected result'),
      ],
      tools: [registeredTool('protected')],
      permissions: permissionService(approvalDecisionFor),
    });
    const launched = await launchedExecution(fixture, {
      awaitApproval: async ({ approval }) => ({
        status: 'denied',
        decision: {
          approvalRequestId: approval.approvalId,
          decision: 'denied',
          decidedBy: 'user',
          decidedAt: NOW,
        },
      }),
    });
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.toolResults[0]?.status).toBe('user_rejected');
  });

  it('rebuilds overflow Context with the same Tool scope and does not project it as an ordinary retry', async () => {
    const fixture = createExecutionFixture({
      streams: [errorOverflowStream(), assistantStream('after compact')],
      contextCompact: compactedOverflowCompaction,
    });
    const released: string[] = [];
    const dependencies = dependenciesFrom(fixture, {
      tools: captureReleases(fixture.dependencies.tools, released),
    });
    const launched = await launchWith(fixture, dependencies);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.contextRuns).toHaveLength(2);
    expect(fixture.contextRuns).toEqual([
      expect.objectContaining({ modelCallId: 'model-call:1' }),
      expect.objectContaining({ modelCallId: 'model-call:1' }),
    ]);
    expect(released).toEqual(['model-call:1']);
    expect(fixture.published.some((event) => event.type === 'turn.retry.started')).toBe(false);
  });

  it('treats Runtime Event publication as best-effort', async () => {
    const fixture = createExecutionFixture({ streams: [assistantStream('done')] });
    const events = { publish: () => { throw new Error('event sink unavailable'); } } as EventBus;
    const launched = await launchWith(fixture, dependenciesFrom(fixture, { events }));
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.writes).toEqual(['user', 'assistant:completed']);
  });

  it('maps Tool definitions into AgentTools including execution mode', async () => {
    const fixture = createExecutionFixture({
      streams: [assistantStream('done')],
      tools: [registeredTool('parallel-lookup', { executionMode: 'parallel' })],
    });
    const contexts: Array<{ tools?: Array<Record<string, unknown>> }> = [];
    const dependencies = dependenciesFrom(fixture, {
      models: captureModelContexts(fixture.dependencies.models, contexts),
    });
    const launched = await launchWith(fixture, dependencies);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(contexts[0]?.tools).toEqual([
      expect.objectContaining({
        name: 'parallel-lookup',
        description: 'parallel-lookup',
        executionMode: 'parallel',
        parameters: expect.objectContaining({ type: 'object' }),
      }),
    ]);
  });

  it('projects real model retries and records every finished Attempt', async () => {
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
    const fixture = createExecutionFixture({
      streams: [retryableFailedStream('retry me'), assistantStream('done')],
      policy: { maxModelCallAttempts: 2 },
      observability,
    });
    const launched = await launchedExecution(fixture);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    expect(fixture.published.map((event) => event.type)).toEqual(expect.arrayContaining([
      'turn.retry.started',
      'turn.retry.completed',
    ]));
    expect(recordLog.mock.calls.filter((call) => (
      (call[0] as { event: string }).event === 'model.call.attempt.finished'
    ))).toHaveLength(2);
    const measurements = recordMeasurement.mock.calls.map((call) => call[0] as { name: string });
    expect(measurements.filter((item) => item.name === 'model.call.attempt')).toHaveLength(2);
    expect(measurements.map((item) => item.name)).toEqual(expect.arrayContaining([
      'model.call.usage',
      'model.call.duration_ms',
      'model.call.retry',
    ]));
  });

  it('publishes ordered message and turn runtime events for one completed execution', async () => {
    const fixture = createExecutionFixture({
      streams: [
        assistantStream('using tool', { id: 'call:1', name: 'lookup', arguments: {} }),
        assistantStream('final answer'),
      ],
      tools: [registeredTool('lookup')],
    });
    const launched = await launchedExecution(fixture);
    const outcome = await launched.execute();

    expect(outcome.status).toBe('completed');
    const types = collectEvents(fixture, 'execution:1').map((event) => event.type);
    expect(types[0]).toBe('turn.started');
    expect(types.filter((type) => type === 'turn.started')).toHaveLength(2);
    expect(types.filter((type) => type === 'turn.ended')).toHaveLength(2);
    expect(types.at(-1)).toBe('turn.ended');
    expect(types.indexOf('message.started')).toBeLessThan(types.indexOf('message.update'));
    expect(types.indexOf('tool_execution.requested')).toBeLessThan(types.indexOf('tool_execution.ended'));
    expect(types).toContain('message.ended');
    // Each turn's lifecycle closes before the next turn starts.
    const secondTurnIndex = types.lastIndexOf('turn.started');
    expect(types.indexOf('turn.ended')).toBeLessThan(secondTurnIndex);
  });
});

function approvalDecisionFor(
  request: import('@megumi/permissions').EvaluateToolCallRequest,
): Extract<PermissionDecision, { type: 'requires_approval' }> {
  const allowed = {
    type: 'allow' as const,
    operations: [...request.operations],
    safetyAssessment: 'safe' as const,
    safetySummary: 'Safe in test.',
    reason: 'Allowed in test.',
  };
  const identity = request.operations[0]?.context.toolIdentity ?? {
    sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'internal', registeredToolName: 'internal',
  };
  return {
    ...allowed,
    type: 'requires_approval',
    reason: 'Approval required.',
    options: [{
      optionId: `once:${request.toolCallId}`,
      scope: 'once',
      display: { label: 'Once', description: 'Allow once.' },
      effect: { type: 'current_tool_call' },
    }],
    defaultOptionId: `once:${request.toolCallId}`,
    subjectFingerprint: `test-subject:${request.toolCallId}:${identity.registeredToolName}`,
  };
}

function launchWith(
  fixture: ExecutionFixture,
  dependencies: ExecuteAgentDependencies,
) {
  return launchAgentExecution({
    metadata: executionMetadata(),
    input: {
      displayContent: [{ type: 'text', text: 'hello' }],
      modelContent: [{ type: 'text', text: 'hello' }],
      attachments: [],
    },
    awaitApproval: async () => ({ status: 'cancelled' as const }),
  }, dependencies);
}

function dependenciesFrom(
  fixture: ExecutionFixture,
  overrides: Partial<ExecuteAgentDependencies> = {},
): ExecuteAgentDependencies {
  return {
    ...fixture.dependencies,
    ...overrides,
  };
}

function captureReleases(
  tools: ExecuteAgentDependencies['tools'],
  released: string[],
): ExecuteAgentDependencies['tools'] {
  return {
    bindExecution(request) {
      const result = tools.bindExecution(request);
      if (result.status === 'failed') return result;
      return {
        status: 'bound',
        binding: {
          executionId: result.binding.executionId,
          prepareModelCall(input) {
            const prepared = result.binding.prepareModelCall(input);
            if (prepared.status === 'failed') return prepared;
            let closed = false;
            return {
              status: 'prepared',
              binding: {
                ...prepared.binding,
                close() {
                  if (closed) return;
                  closed = true;
                  released.push(prepared.binding.modelCallId);
                  prepared.binding.close();
                },
              },
            };
          },
          close: () => result.binding.close(),
        },
      };
    },
  };
}

function captureModelContexts(models: import('@megumi/ai').Models, captured: unknown[]): import('@megumi/ai').Models {
  return {
    ...models,
    streamSimple(modelInput, context, options) {
      captured.push(context);
      return models.streamSimple(modelInput, context, options);
    },
  } as import('@megumi/ai').Models;
}
