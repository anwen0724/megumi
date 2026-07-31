/*
 * Shares focused ToolCall test facts without exporting production test seams.
 */
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
import type {
  ProcessToolCallsRequest,
  ToolCall,
} from '../../../packages/engine/src/tool-call';

export const now = '2026-07-31T00:00:00.000Z';
export const policy: EnginePolicy = {
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

export function run(): Run {
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

export function storeForRun(currentRun = run()): ActiveRunStore {
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

export function registeredTool(
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

export function toolCall(
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

export function allowDecision(request: {
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

function permissionService(): Pick<
  PermissionService,
  'evaluateToolCall' | 'applyApprovalDecision'
> {
  return {
    evaluateToolCall: async (permissionRequest) => {
      const decision = allowDecision(permissionRequest);
      return { status: 'ok', operations: decision.operations, decision };
    },
    applyApprovalDecision: async () => ({
      status: 'applied',
      effect: { type: 'none' },
    }),
  };
}

export function succeeded(toolName: string): ToolExecutionResult {
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

export function request(input: {
  calls: readonly ToolCall[];
  tools: readonly RegisteredTool[];
  store?: ActiveRunStore;
  permissions?: Pick<PermissionService, 'evaluateToolCall' | 'applyApprovalDecision'>;
  executeTool?: ProcessToolCallsRequest['toolExecution']['executeTool'];
  signal?: AbortSignal;
  overridePolicy?: Partial<EnginePolicy>;
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
      createToolExecutionId: () => `tool-execution:${++executionNumber}`,
      createRunApprovalId: () => `approval:${++approvalNumber}`,
    },
    clock: { now: () => now },
    policy: { ...policy, ...input.overridePolicy },
    signal: input.signal ?? new AbortController().signal,
  };
}
