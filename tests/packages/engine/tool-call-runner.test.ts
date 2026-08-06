/*
 * Protects the isolated ToolCall batch: same-modelCallId routing and
 * execution, the serial/parallel window, model-visible permission and
 * rejection results, cancellation convergence, and approval flowing only
 * through the loop-provided requestApproval() callback.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import type { Permissions } from '@megumi/permissions';
import type { CompletedToolCall } from '../../../packages/engine/src/model-call-runner';
import {
  runToolCallBatch,
  type ApprovalResolution,
  type RequestApprovalInput,
  type RunToolCallBatchRequest,
} from '../../../packages/engine/src/tool-call-runner';
import { approvalDecisionFor } from './runs-test-fixtures';
import {
  permissionService,
  registeredTool,
  restrictedExecutionAccess,
  succeeded,
  toolsForRun,
  type RegisteredTool,
  type TestToolExecute,
} from './tool-call-test-fixtures';

const policy = {
  maxConcurrentToolExecutions: 2,
  toolExecutionTimeoutMs: 1_000,
};

function call(order: number, toolName: string, input: unknown = { value: toolName }): CompletedToolCall {
  return { toolCallId: `call:${order}`, sourceModelCallId: 'model-call:1', callOrder: order, toolName, input };
}

function createBatchHarness(input: {
  tools?: RegisteredTool[];
  toolsOverride?: RunToolCallBatchRequest['tools'];
  permissions?: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  executeTool?: TestToolExecute;
  requestApproval?: (approvalInput: RequestApprovalInput) => Promise<ApprovalResolution>;
  calls?: readonly CompletedToolCall[];
} = {}) {
  const events: AnyEvent[] = [];
  let executionNumber = 0;
  const requestApproval = input.requestApproval ?? vi.fn(async () => {
    throw new Error('requestApproval must not be called without approval-requiring permissions.');
  });
  const abortController = new AbortController();
  const request: RunToolCallBatchRequest = {
    runId: 'run:1',
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    permissionMode: 'ask',
    modelCallId: 'model-call:1',
    calls: input.calls ?? [],
    signal: abortController.signal,
    tools: input.toolsOverride ?? toolsForRun(input.tools ?? [], input.executeTool),
    permissions: input.permissions ?? permissionService(),
    policy,
    ids: { createToolExecutionId: () => `tool-execution:${++executionNumber}` },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    events: {
      runId: 'run:1',
      sessionId: 'session:1',
      publish: <TType extends import('@megumi/events').EventType>(
        type: TType,
        payload: import('@megumi/events').EventPayloadByType[TType],
      ) => {
        events.push({ type, payload, sessionId: 'session:1', runId: 'run:1', sequence: events.length + 1 } as AnyEvent);
      },
    },
    observation: {
      startSpan: () => undefined,
      endSpan: () => undefined,
    },
    requestApproval,
  };
  return {
    request,
    run: () => runToolCallBatch(request),
    events,
    abort: () => abortController.abort(),
    requestApproval,
  };
}

describe('ToolCall Runner', () => {
  it('routes and executes every call through the same modelCallId', async () => {
    const tool = registeredTool('lookup');
    const routedIds: string[] = [];
    const executedIds: string[] = [];
    const tools = toolsForRun([tool], async ({ toolName }) => succeeded(toolName));
    const harness = createBatchHarness({
      tools: [tool],
      toolsOverride: {
        ...tools,
        routeToolCall: (route) => {
          routedIds.push(route.modelCallId);
          return tools.routeToolCall(route);
        },
        executeToolInvocation: (input, options) => {
          executedIds.push(input.invocation.modelCallId);
          return tools.executeToolInvocation(input, options);
        },
      },
      calls: [call(0, 'lookup'), call(1, 'lookup')],
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    // The one ModelCall resolved one router; routing and execution share it.
    expect(routedIds).toEqual(['model-call:1', 'model-call:1']);
    expect(executedIds).toEqual(['model-call:1', 'model-call:1']);
    expect(outcome.results.map((result) => result.toolCallId)).toEqual(['call:0', 'call:1']);
    expect(outcome.results.every((result) => result.status === 'success')).toBe(true);
  });

  it('runs parallel-mode calls concurrently and keeps the model call order', async () => {
    const parallelTool = registeredTool('parallel-tool', { executionMode: 'parallel' });
    const serialTool = registeredTool('serial-tool');
    const executeTool = vi.fn(async ({ toolName }: { toolName: string }) => {
      await new Promise((resolve) => setTimeout(resolve, toolName === 'parallel-tool' ? 20 : 5));
      return succeeded(toolName);
    });
    const harness = createBatchHarness({
      tools: [parallelTool, serialTool],
      executeTool,
      calls: [
        call(0, 'parallel-tool'),
        call(1, 'parallel-tool'),
        call(2, 'serial-tool'),
      ],
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.results.map((result) => result.toolCallId)).toEqual(['call:0', 'call:1', 'call:2']);
    const parallelCalls = executeTool.mock.calls.filter(([request]) => request.toolName === 'parallel-tool');
    expect(parallelCalls).toHaveLength(2);
  });

  it('forms model-visible ToolResults for permission denial and tool failures', async () => {
    const tool = registeredTool('protected-tool');
    const denied = await createBatchHarness({
      tools: [tool],
      permissions: permissionService(() => ({
        type: 'deny',
        operations: [],
        safetyAssessment: 'prohibited',
        safetySummary: 'Denied.',
        reason: 'Denied in test.',
        denialCode: 'rule_denied',
      })),
      calls: [call(0, 'protected-tool')],
    }).run();
    expect(denied).toMatchObject({
      status: 'completed',
      results: [{
        toolCallId: 'call:0',
        status: 'permission_denied',
        error: { code: 'rule_denied' },
      }],
    });

    const failed = await createBatchHarness({
      tools: [tool],
      executeTool: async ({ toolName }) => ({
        type: 'failed',
        toolName,
        error: { code: 'tool_execution_failed', message: 'boom' },
        normalizedResult: { kind: 'error', content: 'boom', isError: true, truncated: false },
      }),
      calls: [call(0, 'protected-tool')],
    }).run();
    expect(failed).toMatchObject({
      status: 'completed',
      results: [{
        toolCallId: 'call:0',
        status: 'failure',
        error: { code: 'tool_execution_failed' },
      }],
    });
  });

  it('requests approval only through requestApproval and converts a denied decision', async () => {
    const tool = registeredTool('approval-tool');
    const requestApproval = vi.fn(async (_approvalInput: RequestApprovalInput) => ({
      status: 'denied' as const,
      decision: {
        approvalRequestId: 'approval:1',
        decision: 'denied' as const,
        decidedBy: 'user' as const,
        decidedAt: '2026-07-31T00:00:00.000Z',
      },
    }));
    const harness = createBatchHarness({
      tools: [tool],
      permissions: permissionService((request) => approvalDecisionFor(request)),
      requestApproval,
      calls: [call(0, 'approval-tool')],
    });

    const outcome = await harness.run();

    expect(outcome).toMatchObject({
      status: 'completed',
      results: [{
        toolCallId: 'call:0',
        status: 'user_rejected',
        error: { code: 'user_rejected' },
      }],
    });
    // The approval request flowed through the callback with the call facts;
    // the runner never touches Run state or the registry.
    expect(requestApproval).toHaveBeenCalledOnce();
    expect((requestApproval.mock.calls[0]?.[0] as RequestApprovalInput | undefined)).toMatchObject({
      call: { toolCallId: 'call:0' },
      decision: { type: 'requires_approval' },
    });
  });

  it('converges as cancelled when the approval wait is cancelled', async () => {
    const tool = registeredTool('approval-tool');
    let settleApproval!: (resolution: ApprovalResolution) => void;
    const approvalGate = new Promise<ApprovalResolution>((resolve) => {
      settleApproval = resolve;
    });
    const harness = createBatchHarness({
      tools: [tool],
      permissions: permissionService((request) => approvalDecisionFor(request)),
      requestApproval: vi.fn(async () => approvalGate),
      calls: [call(0, 'approval-tool')],
    });
    const running = harness.run();
    await vi.waitFor(() => {
      expect(harness.requestApproval).toHaveBeenCalled();
    });
    harness.abort();
    settleApproval({ status: 'cancelled' });

    const outcome = await running;

    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    expect(outcome.results).toEqual([
      expect.objectContaining({
        toolCallId: 'call:0',
        status: 'cancelled',
        error: expect.objectContaining({ code: 'tool_cancelled' }),
      }),
    ]);
  });

  it('converges as cancelled when cancellation lands during permission evaluation', async () => {
    const tool = registeredTool('protected-tool');
    let settlePermission!: (value: unknown) => void;
    const permissionGate = new Promise((resolve) => {
      settlePermission = resolve;
    });
    const evaluateToolCall = vi.fn(async () => {
      await permissionGate;
      return {
        status: 'ok',
        operations: [],
        decision: { type: 'allow', operations: [], safetyAssessment: 'safe', safetySummary: 'Safe.', reason: 'Allowed.' },
        approvalSubject: { version: 1, toolCallId: 'call:0', toolIdentity: {}, operations: [], safetyAssessment: 'safe', riskFacts: {}, fingerprint: 'f' },
        executionAccess: restrictedExecutionAccess,
      };
    });
    const executeTool = vi.fn();
    const harness = createBatchHarness({
      tools: [tool],
      permissions: {
        evaluateToolCall: evaluateToolCall as never,
        applyApprovalDecision: vi.fn(),
      },
      executeTool,
      calls: [call(0, 'protected-tool')],
    });
    const running = harness.run();
    await vi.waitFor(() => {
      expect(evaluateToolCall).toHaveBeenCalled();
    });
    harness.abort();
    settlePermission({ status: 'ok' });

    const outcome = await running;

    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    // The stale permission result never started a new execution.
    expect(executeTool).not.toHaveBeenCalled();
    expect(harness.events.some((event) => event.type === 'tool_execution.started')).toBe(false);
    expect(outcome.results).toEqual([
      expect.objectContaining({ toolCallId: 'call:0', status: 'cancelled' }),
    ]);
  });

  it('converges as cancelled when cancellation lands after the approval resolved', async () => {
    const tool = registeredTool('approval-tool');
    let settleApproval!: (resolution: ApprovalResolution) => void;
    const approvalGate = new Promise<ApprovalResolution>((resolve) => {
      settleApproval = resolve;
    });
    const executeTool = vi.fn();
    const harness = createBatchHarness({
      tools: [tool],
      permissions: permissionService((request) => approvalDecisionFor(request)),
      requestApproval: vi.fn(async () => approvalGate),
      executeTool,
      calls: [call(0, 'approval-tool')],
    });
    const running = harness.run();
    await vi.waitFor(() => {
      expect(harness.requestApproval).toHaveBeenCalled();
    });
    harness.abort();
    // The user approved, but cancellation won before the original call stack
    // resumed: the approved execution must not start.
    settleApproval({
      status: 'approved',
      decision: {
        approvalRequestId: 'approval:1',
        decision: 'approved',
        optionId: 'once:call:0',
        decidedBy: 'user',
        decidedAt: '2026-07-31T00:00:00.000Z',
      },
    });

    const outcome = await running;

    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    expect(executeTool).not.toHaveBeenCalled();
    expect(harness.events.some((event) => event.type === 'tool_execution.started')).toBe(false);
    expect(outcome.results).toEqual([
      expect.objectContaining({ toolCallId: 'call:0', status: 'cancelled' }),
    ]);
  });

  it('converges as cancelled when the tool execution observes the abort', async () => {
    const tool = registeredTool('slow-tool');
    const executeTool = vi.fn(async (
      _request: { toolName: string },
      options?: { signal?: AbortSignal },
    ): Promise<import('@megumi/tools').ToolExecutionResult> => new Promise((resolve) => {
      options?.signal?.addEventListener('abort', () => resolve({
        type: 'failed',
        toolName: 'slow-tool',
        error: { code: 'tool_cancelled', message: 'cancelled' },
        normalizedResult: { kind: 'error', content: 'cancelled', isError: true, truncated: false },
      }), { once: true });
    }));
    const harness = createBatchHarness({
      tools: [tool],
      executeTool,
      calls: [call(0, 'slow-tool')],
    });
    const running = harness.run();
    await vi.waitFor(() => {
      expect(executeTool).toHaveBeenCalledOnce();
    });
    harness.abort();

    const outcome = await running;

    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    expect(outcome.results).toEqual([
      expect.objectContaining({
        toolCallId: 'call:0',
        status: 'cancelled',
        error: expect.objectContaining({ code: 'tool_cancelled' }),
      }),
    ]);
  });
});
