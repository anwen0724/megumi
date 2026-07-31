/*
 * Protects ToolCall result normalization, execution identity, timeout, and scheduling windows.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  PermissionDecision,
  PermissionMode,
  PermissionService,
} from '@megumi/agent/permissions';
import type {
  RegisteredTool,
  ToolExecutionResult,
} from '@megumi/agent/tools';
import type { EnginePolicy, Run } from '@megumi/engine';
import { ActiveRunStore } from '../../../packages/engine/src/active-run-store';
import { createRun } from '../../../packages/engine/src/run';
import {
  processToolCalls,
  type ProcessToolCallsRequest,
  type ToolCall,
} from '../../../packages/engine/src/tool-call';

const now = '2026-07-31T00:00:00.000Z';
const policy: EnginePolicy = {
  maxModelCallsPerRun: 8,
  maxToolRoundsPerRun: 6,
  maxToolCallsPerModelCall: 8,
  maxToolCallsPerRun: 24,
  maxConcurrentToolExecutions: 2,
  modelCallTimeoutMs: 60_000,
  toolExecutionTimeoutMs: 100,
  cancellationTimeoutMs: 5_000,
  maxModelCallAttempts: 2,
  modelRetryDelayMs: 0,
  maxToolExecutionsPerCall: 1,
  toolRetryDelayMs: 0,
  terminalRunRetentionMs: 60_000,
};

function run(): Run {
  return createRun({
    runId: 'run:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model: {} as Parameters<typeof createRun>[0]['model'],
    permissionMode: 'ask',
    createdAt: now,
  });
}

function storeForRun(currentRun = run()): ActiveRunStore {
  const store = new ActiveRunStore({
    clock: { now: () => now },
    terminalRunRetentionMs: policy.terminalRunRetentionMs,
  });
  store.reserveStart({
    requestId: currentRun.requestId,
    fingerprint: {
      workspaceId: currentRun.workspaceId,
      sessionId: currentRun.sessionId,
      inputDigest: 'sha256:input',
    },
    run: currentRun,
  });
  return store;
}

function registeredTool(
  name: string,
  input: {
    executionMode?: 'parallel' | 'serial';
    required?: string[];
    idempotentHint?: boolean;
  } = {},
): RegisteredTool {
  return {
    identity: {
      sourceId: 'built-in',
      namespace: 'megumi',
      sourceToolName: name,
    },
    definition: {
      name,
      description: name,
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: input.required ?? [],
        additionalProperties: false,
      },
      annotations: {
        ...(input.idempotentHint === undefined
          ? {}
          : { idempotentHint: input.idempotentHint }),
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
      executionMode: input.executionMode ?? 'serial',
    },
    registeredToolName: name,
    source: {
      sourceId: 'built-in',
      sourceKind: 'built_in',
      namespace: 'megumi',
      displayName: 'Built in',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    status: 'available',
  };
}

function toolCall(
  callOrder: number,
  toolName: string,
  input: unknown = { value: toolName },
): ToolCall {
  return {
    toolCallId: `tool-call:${callOrder}`,
    modelCallId: 'model-call:1',
    callOrder,
    toolName,
    input,
  };
}

function allowDecision(request: {
  run_id: string;
  session_id: string;
  workspace_id: string;
  registered_tool: {
    source_id: string;
    namespace: string;
    source_tool_name: string;
    registered_tool_name: string;
  };
}): Extract<PermissionDecision, { type: 'allow' }> {
  return {
    type: 'allow',
    operations: [{
      action: 'agent.context.activate',
      context: {
        workspace_id: request.workspace_id,
        session_id: request.session_id,
        run_id: request.run_id,
        tool_identity: request.registered_tool,
      },
    }],
    safety_assessment: 'safe',
    reason: 'Allowed in test.',
  };
}

function permissionService(
  decide: (
    request: Parameters<PermissionService['evaluateToolCall']>[0],
  ) => PermissionDecision = allowDecision,
): Pick<PermissionService, 'evaluateToolCall' | 'applyApprovalDecision'> {
  const evaluateToolCall: PermissionService['evaluateToolCall'] = vi.fn(
    async (request) => {
      const decision = decide(request);
      return {
        status: 'ok' as const,
        operations: decision.operations,
        decision,
      };
    },
  );
  const applyApprovalDecision: PermissionService['applyApprovalDecision'] = vi.fn(
    async () => ({
      status: 'applied' as const,
      effect: { type: 'none' as const },
    }),
  );
  return {
    evaluateToolCall,
    applyApprovalDecision,
  };
}

function succeeded(toolName: string): ToolExecutionResult {
  return {
    type: 'succeeded',
    toolName,
    rawResult: { outputKind: 'text', content: `result:${toolName}` },
    normalizedResult: {
      kind: 'text',
      content: `result:${toolName}`,
      isError: false,
      truncated: false,
    },
  };
}

function request(input: {
  calls: readonly ToolCall[];
  tools: readonly RegisteredTool[];
  store?: ActiveRunStore;
  permissions?: Pick<PermissionService, 'evaluateToolCall' | 'applyApprovalDecision'>;
  executeTool?: ProcessToolCallsRequest['toolExecution']['executeTool'];
  signal?: AbortSignal;
  overridePolicy?: Partial<EnginePolicy>;
  onExecutionId?: (id: string) => void;
}): ProcessToolCallsRequest {
  let executionNumber = 0;
  let approvalNumber = 0;
  return {
    runId: 'run:1',
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    permissionMode: 'ask' satisfies PermissionMode,
    toolCalls: input.calls,
    registeredTools: input.tools,
    permissions: input.permissions ?? permissionService(),
    toolExecution: {
      executeTool: input.executeTool ?? (async ({ toolName }) => succeeded(toolName)),
    },
    store: input.store ?? storeForRun(),
    ids: {
      createToolExecutionId: () => {
        const id = `tool-execution:${++executionNumber}`;
        input.onExecutionId?.(id);
        return id;
      },
      createRunApprovalId: () => `approval:${++approvalNumber}`,
    },
    clock: { now: () => now },
    policy: { ...policy, ...input.overridePolicy },
    signal: input.signal ?? new AbortController().signal,
  };
}

describe('processToolCalls result mapping', () => {
  it('forms unknown and invalid ToolResults without creating ToolExecutions', async () => {
    const createExecutionId = vi.fn();
    const known = registeredTool('known', { required: ['value'] });
    const processingRequest = request({
      calls: [
        toolCall(0, 'missing'),
        toolCall(1, 'known', {}),
      ],
      tools: [known],
      onExecutionId: createExecutionId,
    });

    const result = await processToolCalls(processingRequest);

    expect(result.status).toBe('completed');
    expect(result.toolResults).toMatchObject([
      {
        toolCallId: 'tool-call:0',
        status: 'failure',
        error: { code: 'unknown_tool' },
      },
      {
        toolCallId: 'tool-call:1',
        status: 'failure',
        error: { code: 'invalid_tool_input' },
      },
    ]);
    expect(result.toolExecutions).toEqual([]);
    expect(createExecutionId).not.toHaveBeenCalled();
    expect(processingRequest.permissions.evaluateToolCall).not.toHaveBeenCalled();
  });

  it('maps permission denial without executing the tool', async () => {
    const tool = registeredTool('protected');
    const permissions = permissionService((permissionRequest) => ({
      ...allowDecision(permissionRequest),
      type: 'deny',
      reason: 'Denied by policy.',
      denial_code: 'policy_denied',
    }));
    const executeTool = vi.fn();
    const result = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      permissions,
      executeTool,
    }));

    expect(result.toolResults).toMatchObject([{
      status: 'permission_denied',
      error: { code: 'policy_denied', message: 'Denied by policy.' },
    }]);
    expect(result.toolExecutions).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('uses continuous parallel windows, serial barriers, concurrency limits, and call-order results', async () => {
    const tools = [
      registeredTool('p1', { executionMode: 'parallel' }),
      registeredTool('p2', { executionMode: 'parallel' }),
      registeredTool('serial', { executionMode: 'serial' }),
      registeredTool('p3', { executionMode: 'parallel' }),
      registeredTool('p4', { executionMode: 'parallel' }),
    ];
    let active = 0;
    let maxActive = 0;
    const completionOrder: string[] = [];
    const executeTool = vi.fn(async ({ toolName }: { toolName: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const delay = toolName === 'p1' || toolName === 'p3' ? 10 : 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      completionOrder.push(toolName);
      return succeeded(toolName);
    });
    const processingRequest = request({
      calls: tools.map((tool, index) => toolCall(index, tool.registeredToolName)),
      tools,
      executeTool,
    });

    const result = await processToolCalls(processingRequest);

    expect(result.status).toBe('completed');
    expect(maxActive).toBe(2);
    expect(completionOrder.indexOf('serial')).toBeGreaterThan(completionOrder.indexOf('p1'));
    expect(completionOrder.indexOf('p3')).toBeGreaterThan(completionOrder.indexOf('serial'));
    expect(result.toolResults.map((toolResult) => toolResult.toolCallId)).toEqual([
      'tool-call:0',
      'tool-call:1',
      'tool-call:2',
      'tool-call:3',
      'tool-call:4',
    ]);
    expect(result.toolExecutions).toHaveLength(5);
    expect(processingRequest.store.getActiveToolExecutionIds('run:1')).toEqual([]);
  });

  it('does not retry an execution from idempotentHint alone', async () => {
    const tool = registeredTool('fragile', {
      executionMode: 'serial',
      idempotentHint: true,
    });
    const executeTool = vi.fn(async (): Promise<ToolExecutionResult> => ({
      type: 'failed',
      toolName: tool.registeredToolName,
      error: { code: 'tool_execution_failed', message: 'Failed once.' },
      normalizedResult: {
        kind: 'error',
        content: 'Failed once.',
        isError: true,
        truncated: false,
      },
    }));
    const result = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool,
    }));

    expect(executeTool).toHaveBeenCalledOnce();
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolResults).toMatchObject([{
      status: 'failure',
      error: { code: 'tool_execution_failed' },
    }]);
  });

  it('distinguishes timeout from Run cancellation', async () => {
    const tool = registeredTool('slow');
    const never = () => new Promise<ToolExecutionResult>(() => undefined);
    const timedOut = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool: never,
      overridePolicy: { toolExecutionTimeoutMs: 5 },
    }));
    expect(timedOut.toolResults).toMatchObject([{
      status: 'failure',
      error: { code: 'tool_execution_timeout' },
    }]);
    expect(timedOut.toolExecutions).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    const executeTool = vi.fn(never);
    const cancelled = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool,
      signal: controller.signal,
    }));
    expect(cancelled.toolResults).toMatchObject([{
      status: 'cancelled',
      error: { code: 'tool_cancelled' },
    }]);
    expect(cancelled.toolExecutions).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
