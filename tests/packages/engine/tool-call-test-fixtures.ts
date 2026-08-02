/* Shares focused ToolCall test facts without exporting production test seams. */

import { vi } from 'vitest';
import type {
  ApprovalSubject,
  EvaluateToolCallRequest,
  PermissionDecision,
  PermissionMode,
  Permissions,
} from '@megumi/permissions';
import {
  createToolRouter,
  type RegisteredTool,
  type ToolExecutionAccess,
  type ToolExecutionOptions,
  type ToolExecutionResult,
  type Tools,
} from '@megumi/tools';
import type { EnginePolicy, Run } from '@megumi/engine';
import { ActiveRunStore } from '../../../packages/engine/src/active-run-store';
import { createRun } from '../../../packages/engine/src/run';
import type { ProcessToolCallsRequest, ToolCall } from '../../../packages/engine/src/tool-call';

export type TestToolExecute = (
  request: { readonly toolName: string; readonly input: unknown },
  options?: ToolExecutionOptions,
) => Promise<ToolExecutionResult>;

export const restrictedExecutionAccess: ToolExecutionAccess = {
  fileSystem: { mode: 'workspace' }, process: 'sandboxed', network: 'denied',
};
export const unrestrictedExecutionAccess: ToolExecutionAccess = {
  fileSystem: { mode: 'unrestricted' }, process: 'unrestricted', network: 'unrestricted',
};
export const now = '2026-07-31T00:00:00.000Z';
export const policy: EnginePolicy = {
  maxModelCallsPerRun: 8, maxToolRoundsPerRun: 6, maxToolCallsPerModelCall: 8,
  maxToolCallsPerRun: 24, maxConcurrentToolExecutions: 2, modelCallTimeoutMs: 60_000,
  modelCallTerminationTimeoutMs: 10_000, toolExecutionTimeoutMs: 100,
  cancellationTimeoutMs: 5_000, maxModelCallAttempts: 2, modelRetryDelayMs: 0,
  maxToolExecutionsPerCall: 1, toolRetryDelayMs: 0, terminalRunRetentionMs: 60_000,
};

export function run(): Run {
  return createRun({
    runId: 'run:1', requestId: 'request:1', workspaceId: 'workspace:1', sessionId: 'session:1',
    userMessageId: 'message:1', model: {} as Parameters<typeof createRun>[0]['model'],
    permissionMode: 'ask', createdAt: now,
  });
}

export function storeForRun(currentRun = run()): ActiveRunStore {
  const store = new ActiveRunStore({ clock: { now: () => now }, terminalRunRetentionMs: policy.terminalRunRetentionMs });
  store.reserveStart({
    requestId: currentRun.requestId,
    fingerprint: { workspaceId: currentRun.workspaceId, sessionId: currentRun.sessionId, inputDigest: 'sha256:input' },
    run: currentRun,
  });
  return store;
}

export function registeredTool(
  name: string,
  input: { executionMode?: 'parallel' | 'serial'; required?: string[]; idempotentHint?: boolean } = {},
): RegisteredTool {
  const identity = { sourceId: 'built_in', namespace: 'megumi', sourceToolName: name };
  return {
    registrationId: `registration:${name}`,
    identity,
    definition: {
      name, description: name,
      inputSchema: {
        type: 'object', properties: { value: { type: 'string' } },
        required: input.required ?? [], additionalProperties: false,
      },
      annotations: input.idempotentHint === undefined ? {} : { idempotentHint: input.idempotentHint },
    },
    handler: {
      toolName: name,
      operations: (invocation) => [{
        action: 'agent.context.activate',
        context: {
          workspaceId: invocation.workspaceId, sessionId: invocation.sessionId, runId: invocation.runId,
          toolIdentity: invocation.toolIdentity,
        },
      }],
      async execute() { return { outputKind: 'text', content: `result:${name}` }; },
    },
    registeredToolName: name,
    source: {
      sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', displayName: 'Built in',
      configured: true, enabled: true, availabilityStatus: 'available',
    },
    availability: { status: 'available' },
    executionMode: input.executionMode ?? 'serial',
  };
}

export function toolCall(callOrder: number, toolName: string, input: unknown = { value: toolName }): ToolCall {
  return { toolCallId: `tool-call:${callOrder}`, modelCallId: 'model-call:1', callOrder, toolName, input };
}

export function allowDecision(request: EvaluateToolCallRequest): Extract<PermissionDecision, { type: 'allow' }> {
  return {
    type: 'allow', operations: request.operations, safetyAssessment: 'safe',
    safetySummary: 'Safe in Engine test.', reason: 'Allowed in test.',
  };
}

export function approvalSubjectFor(request: EvaluateToolCallRequest, decision: PermissionDecision): ApprovalSubject {
  const identity = request.operations[0]?.context.toolIdentity ?? {
    sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'internal', registeredToolName: 'internal',
  };
  return {
    version: 1, toolCallId: request.toolCallId, toolIdentity: identity,
    criticalInput: request.toolInput, operations: decision.operations,
    safetyAssessment: decision.safetyAssessment, riskFacts: {},
    fingerprint: `test-subject:${request.toolCallId}:${identity.registeredToolName}`,
  };
}

export function permissionService(
  decide: (request: EvaluateToolCallRequest) => PermissionDecision = allowDecision,
): Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'> {
  const evaluateToolCall: Permissions['evaluateToolCall'] = vi.fn(async (permissionRequest) => {
    const decision = decide(permissionRequest);
    return {
      status: 'ok' as const, operations: decision.operations, decision,
      approvalSubject: approvalSubjectFor(permissionRequest, decision),
      ...(decision.type === 'allow' ? { executionAccess: restrictedExecutionAccess } : {}),
    };
  });
  return {
    evaluateToolCall,
    applyApprovalDecision: vi.fn(async () => ({
      status: 'applied' as const, effect: { type: 'none' as const }, executionAccess: unrestrictedExecutionAccess,
    })),
  };
}

export function succeeded(toolName: string): ToolExecutionResult {
  return {
    type: 'succeeded', toolName,
    normalizedResult: { kind: 'text', content: `result:${toolName}`, isError: false, truncated: false },
  };
}

export function toolsForRun(
  tools: readonly RegisteredTool[],
  execute: TestToolExecute = async ({ toolName }) => succeeded(toolName),
): Pick<Tools, 'resolveModelCallTools' | 'routeToolCall' | 'executeToolInvocation' | 'releaseModelCallTools'> {
  const routers = new Map<string, ReturnType<typeof createToolRouter>>();
  const resolve = (scope: { runId: string; sessionId: string; workspaceId: string; modelCallId: string }) => {
    let router = routers.get(scope.modelCallId);
    if (!router) {
      router = createToolRouter({ scope, tools });
      routers.set(scope.modelCallId, router);
    }
    return router;
  };
  resolve({ runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', modelCallId: 'model-call:1' });
  return {
    resolveModelCallTools: (scope) => ({ status: 'resolved', definitions: resolve(scope).definitions() }),
    routeToolCall: (call) => resolve(call).route(call),
    executeToolInvocation: (input, options) => execute({
      toolName: input.invocation.toolName, input: input.invocation.input,
    }, options),
    releaseModelCallTools: ({ modelCallId }) => { routers.delete(modelCallId); },
  };
}

export function request(input: {
  calls: readonly ToolCall[];
  tools: readonly RegisteredTool[];
  store?: ActiveRunStore;
  permissions?: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  executeTool?: TestToolExecute;
  signal?: AbortSignal;
  overridePolicy?: Partial<EnginePolicy>;
  onExecutionId?: (id: string) => void;
}): ProcessToolCallsRequest {
  let executionNumber = 0;
  let approvalNumber = 0;
  return {
    runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', permissionMode: 'ask' satisfies PermissionMode,
    toolCalls: input.calls, permissions: input.permissions ?? permissionService(),
    tools: toolsForRun(input.tools, input.executeTool), store: input.store ?? storeForRun(),
    ids: {
      createToolExecutionId: () => { const id = `tool-execution:${++executionNumber}`; input.onExecutionId?.(id); return id; },
      createRunApprovalId: () => `approval:${++approvalNumber}`,
    },
    clock: { now: () => now }, policy: { ...policy, ...input.overridePolicy },
    signal: input.signal ?? new AbortController().signal,
  };
}
