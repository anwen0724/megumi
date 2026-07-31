/*
 * Shares focused ToolCall test facts without exporting production test seams.
 */
import { vi } from 'vitest';
import type {
  ApprovalSubject,
  EvaluateToolCallRequest,
  PermissionDecision,
  PermissionMode,
  Permissions,
} from '@megumi/permissions';
import {
  createToolExecutor,
  type RegisteredTool,
  type ToolExecutor,
  type ToolExecutionResult,
} from '@megumi/tools';
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
      sourceId: 'built_in',
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
      sourceId: 'built_in',
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

export function allowDecision(
  request: EvaluateToolCallRequest,
): Extract<PermissionDecision, { type: 'allow' }> {
  return {
    type: 'allow',
    operations: [{
      action: 'agent.context.activate',
      context: {
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        runId: request.runId,
        toolIdentity: {
          sourceId: request.registeredTool.identity.sourceId,
          namespace: request.registeredTool.identity.namespace,
          sourceToolName: request.registeredTool.identity.sourceToolName,
          registeredToolName: request.registeredTool.registeredToolName,
        },
      },
    }],
    safetyAssessment: 'safe',
    safetySummary: 'Safe in Engine test.',
    reason: 'Allowed in test.',
  };
}

export function approvalSubjectFor(
  request: EvaluateToolCallRequest,
  decision: PermissionDecision,
): ApprovalSubject {
  return {
    version: 1,
    toolCallId: request.toolCallId,
    toolIdentity: {
      sourceId: request.registeredTool.identity.sourceId,
      namespace: request.registeredTool.identity.namespace,
      sourceToolName: request.registeredTool.identity.sourceToolName,
      registeredToolName: request.registeredTool.registeredToolName,
    },
    criticalInput: request.toolInput,
    operations: decision.operations,
    safetyAssessment: decision.safetyAssessment,
    riskFacts: {},
    fingerprint: `test-subject:${request.toolCallId}:${request.registeredTool.registeredToolName}`,
  };
}

export function permissionService(
  decide: (
    request: EvaluateToolCallRequest,
  ) => PermissionDecision = allowDecision,
): Pick<
  Permissions,
  'evaluateToolCall' | 'applyApprovalDecision'
> {
  const evaluateToolCall: Permissions['evaluateToolCall'] = vi.fn(async (permissionRequest) => {
    const decision = decide(permissionRequest);
    return {
      status: 'ok' as const,
      operations: decision.operations,
      decision,
      approvalSubject: approvalSubjectFor(permissionRequest, decision),
    };
  });
  const applyApprovalDecision: Permissions['applyApprovalDecision'] = vi.fn(async () => ({
    status: 'applied' as const,
    effect: { type: 'none' as const },
  }));
  return {
    evaluateToolCall,
    applyApprovalDecision,
  };
}

export function succeeded(toolName: string): ToolExecutionResult {
  return {
    type: 'succeeded',
    toolName,
    normalizedResult: {
      kind: 'text',
      content: `result:${toolName}`,
      isError: false,
      truncated: false,
    },
  };
}

export function toolExecutor(
  tools: readonly RegisteredTool[],
  execute: ToolExecutor['execute'] = async ({ toolName }) => succeeded(toolName),
): Pick<ToolExecutor, 'preflight' | 'execute'> {
  const owner = createToolExecutor({
    catalog: {
      list: () => ({ tools }),
      get: ({ toolName }) => {
        const tool = tools.find((candidate) => candidate.registeredToolName === toolName);
        return tool
          ? { status: 'found' as const, tool }
          : { status: 'not_found' as const, toolName };
      },
    },
    adapter: {
      async execute({ toolName }) {
        return { outputKind: 'text', content: `unused:${toolName}` };
      },
    },
  });
  return { preflight: owner.preflight, execute };
}

export function request(input: {
  calls: readonly ToolCall[];
  tools: readonly RegisteredTool[];
  store?: ActiveRunStore;
  permissions?: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  executeTool?: ProcessToolCallsRequest['toolExecution']['execute'];
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
    toolExecution: toolExecutor(input.tools, input.executeTool),
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
