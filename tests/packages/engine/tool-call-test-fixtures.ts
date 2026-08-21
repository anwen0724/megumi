/* Shares focused ToolCall test facts without exporting production test seams. */

import { vi } from 'vitest';
import type {
  ApprovalSubject,
  EvaluateToolCallRequest,
  PermissionDecision,
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

export { createToolRouter };
export type { RegisteredTool };

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
      parameters: {
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
          workspaceId: invocation.workspaceId, sessionId: invocation.sessionId, executionId: invocation.executionId,
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

export function allowDecision(request: EvaluateToolCallRequest): Extract<PermissionDecision, { type: 'allow' }> {
  return {
    type: 'allow', operations: [...request.operations], safetyAssessment: 'safe',
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
  const resolve = (scope: { executionId: string; sessionId: string; workspaceId: string; modelCallId: string }) => {
    let router = routers.get(scope.modelCallId);
    if (!router) {
      router = createToolRouter({ scope, tools });
      routers.set(scope.modelCallId, router);
    }
    return router;
  };
  resolve({ executionId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1', modelCallId: 'model-call:1' });
  return {
    resolveModelCallTools: (scope) => ({ status: 'resolved', definitions: resolve(scope).definitions() }),
    routeToolCall: (call) => resolve(call).route(call),
    executeToolInvocation: (input, options) => execute({
      toolName: input.invocation.toolName, input: input.invocation.input,
    }, options),
    releaseModelCallTools: ({ modelCallId }) => { routers.delete(modelCallId); },
  };
}
