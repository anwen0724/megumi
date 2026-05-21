import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import { validateToolInput } from '@megumi/tools/validation';
import type { ToolRegistry } from '@megumi/tools/registry';
import type {
  PendingToolApproval,
  ToolApprovalResumeInput,
  ToolApprovalResumePort,
  ToolUseHandlerPort,
} from '@megumi/core/run-runtime/tool-loop';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { MergedPermissionSettings } from '@megumi/shared/permission-settings-contracts';
import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import {
  createApprovalRequestedEvent,
  createPermissionDecisionCreatedEvent,
  createToolCallApprovalRequestedEvent,
  createToolCallCompletedEvent,
  createToolCallDeniedEvent,
  createToolCallFailedEvent,
  createToolCallPolicyDecidedEvent,
  createToolCallRequestedEvent,
  createToolCallStartedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolResult,
  ToolUse,
} from '@megumi/shared/tool-contracts';
import type { ToolRepository } from '@megumi/db/repos/tool.repo';
import type { ProjectToolExecutor } from './project-tool-executor.service';

export interface ToolUseHandlerRepositoryPort extends Pick<
  ToolRepository,
  | 'saveToolUse'
  | 'saveToolCall'
  | 'getToolCall'
  | 'savePermissionDecision'
  | 'saveApprovalRequest'
  | 'getApprovalRequest'
  | 'saveToolResult'
> {}

export interface ToolUseHandlerServiceOptions {
  registry: ToolRegistry;
  repository: ToolUseHandlerRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  projectExecutor: ProjectToolExecutor;
  now?: () => string;
  ids?: {
    toolCallId(): string;
    toolResultId(): string;
    permissionDecisionId(): string;
    approvalRequestId(): string;
  };
}

interface ResolvedToolUseHandlerServiceOptions extends ToolUseHandlerServiceOptions {
  now: () => string;
  ids: NonNullable<ToolUseHandlerServiceOptions['ids']>;
}

interface SingleToolUseOutcome {
  toolResult?: ToolResult;
  pendingApproval?: PendingToolApproval;
  runtimeEvents?: RuntimeEvent[];
}

export function createToolUseHandlerService(options: ToolUseHandlerServiceOptions): ToolUseHandlerPort & ToolApprovalResumePort {
  const resolvedOptions: ResolvedToolUseHandlerServiceOptions = {
    ...options,
    now: options.now ?? (() => new Date().toISOString()),
    ids: options.ids ?? {
      toolCallId: () => `tool-call:${crypto.randomUUID()}`,
      toolResultId: () => `tool-result:${crypto.randomUUID()}`,
      permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
      approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
    },
  };

  return {
    async handleToolUses(input) {
      const toolResults: ToolResult[] = [];
      const pendingApprovals: PendingToolApproval[] = [];
      const runtimeEvents: RuntimeEvent[] = [];

      for (const toolUse of input.toolUses) {
        resolvedOptions.repository.saveToolUse(toolUse);
        const outcome = await handleSingleToolUse(resolvedOptions, input.request, toolUse);
        if (outcome.toolResult) {
          toolResults.push(outcome.toolResult);
        }
        if (outcome.pendingApproval) {
          pendingApprovals.push(outcome.pendingApproval);
        }
        runtimeEvents.push(...(outcome.runtimeEvents ?? []));
      }

      return { toolResults, pendingApprovals, runtimeEvents };
    },
    async resumeToolApproval(input) {
      return resumeToolApproval(resolvedOptions, input);
    },
  };
}

async function resumeToolApproval(
  options: ResolvedToolUseHandlerServiceOptions,
  input: ToolApprovalResumeInput,
): Promise<ToolResult | undefined> {
  const approvalRequest = options.repository.getApprovalRequest(input.approvalRequestId);
  if (!approvalRequest) {
    return undefined;
  }

  const toolCall = options.repository.getToolCall(approvalRequest.toolCallId);
  if (!toolCall) {
    return undefined;
  }

  options.repository.saveApprovalRequest({
    ...approvalRequest,
    status: input.decision,
    resolvedAt: input.decidedAt,
  });

  if (input.decision === 'denied') {
    options.repository.saveToolCall({
      ...toolCall,
      status: 'denied',
      completedAt: input.decidedAt,
    });

    return options.repository.saveToolResult({
      toolResultId: options.ids.toolResultId(),
      toolUseId: toolCall.toolUseId,
      toolCallId: toolCall.toolCallId,
      runId: toolCall.runId,
      kind: 'user_rejected',
      textContent: input.reason ?? 'User rejected the requested tool call.',
      denialReason: input.reason ?? 'User rejected the requested tool call.',
      redactionState: 'none',
      createdAt: input.decidedAt,
    });
  }

  const runningToolCall = options.repository.saveToolCall({
    ...toolCall,
    status: 'running',
    startedAt: input.decidedAt,
  });
  const toolResult = await options.projectExecutor.executeToolCall(runningToolCall);

  options.repository.saveToolCall({
    ...runningToolCall,
    status: toolResult.kind === 'success' ? 'succeeded' : 'failed',
    completedAt: toolResult.createdAt,
    resultPreview: toolResult.textContent,
    ...(toolResult.error ? { error: toolResult.error } : {}),
  });

  return options.repository.saveToolResult(toolResult);
}

async function handleSingleToolUse(
  options: ResolvedToolUseHandlerServiceOptions,
  request: ModelStepRuntimeRequest,
  toolUse: ToolUse,
): Promise<SingleToolUseOutcome> {
  const definition = options.registry.getDefinition(toolUse.toolName, {
    runId: String(request.runId),
    permissionMode: options.permissionMode,
    providerCapabilitySummary: { supportsToolUse: true },
  });

  if (!definition) {
    return {
      toolResult: saveImmediateToolError(options, toolUse, `Unknown tool: ${toolUse.toolName}`),
    };
  }

  const validation = validateToolInput(definition, toolUse.input);
  if (!validation.ok) {
    return {
      toolResult: saveImmediateToolError(options, toolUse, validation.errorMessage),
    };
  }

  const requestedToolCall = options.repository.saveToolCall({
    toolCallId: options.ids.toolCallId(),
    toolUseId: toolUse.toolUseId,
    runId: toolUse.runId,
    stepId: request.stepId,
    toolName: definition.name,
    input: toolUse.input,
    inputPreview: toolUse.inputPreview,
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'requested',
    requestedAt: options.now(),
  });
  const runtimeEvents: RuntimeEvent[] = [
    createToolCallRequestedRuntimeEvent(request, requestedToolCall),
  ];

  const evaluatedDecision = evaluatePermissionPolicy({
    definition,
    toolCall: requestedToolCall,
    permissionMode: options.permissionMode,
    projectRoot: options.projectRoot,
    settings: options.settings,
    evaluatedAt: options.now(),
  });
  const decision = options.repository.savePermissionDecision({
    ...evaluatedDecision,
    permissionDecisionId: options.ids.permissionDecisionId(),
  });
  runtimeEvents.push(
    createToolCallPolicyDecidedRuntimeEvent(request, requestedToolCall, decision),
    createPermissionDecisionCreatedRuntimeEvent(request, requestedToolCall, decision),
  );

  if (decision.decision === 'deny') {
    const toolResult = saveDeniedResult(options, toolUse, requestedToolCall, decision);
    runtimeEvents.push(
      createToolCallDeniedRuntimeEvent(request, requestedToolCall, decision.reason),
      createToolResultCreatedRuntimeEvent(request, toolResult),
    );
    return {
      toolResult,
      runtimeEvents,
    };
  }

  if (decision.decision === 'ask') {
    const approvalRequest = options.repository.saveApprovalRequest(
      createApprovalRequest(options, request, toolUse, requestedToolCall, decision),
    );
    const waitingToolCall = options.repository.saveToolCall({
      ...requestedToolCall,
      policyDecision: decision,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'waiting_for_approval',
    });
    runtimeEvents.push(
      createToolCallApprovalRequestedRuntimeEvent(request, waitingToolCall, approvalRequest),
      createApprovalRequestedRuntimeEvent(request, approvalRequest),
    );
    return {
      pendingApproval: { approvalRequest, toolUse, toolCall: waitingToolCall },
      runtimeEvents,
    };
  }

  const runningToolCall = options.repository.saveToolCall({
    ...requestedToolCall,
    policyDecision: decision,
    sandboxRequirement: decision.requiredSandbox,
    status: 'running',
    startedAt: options.now(),
  });
  runtimeEvents.push(createToolCallStartedRuntimeEvent(request, runningToolCall));
  const result = await options.projectExecutor.executeToolCall(runningToolCall);
  const completedToolCall = options.repository.saveToolCall({
    ...runningToolCall,
    status: result.kind === 'success' ? 'succeeded' : 'failed',
    completedAt: result.createdAt,
    resultPreview: result.textContent,
    ...(result.error ? { error: result.error } : {}),
  });
  runtimeEvents.push(
    result.kind === 'success'
      ? createToolCallCompletedRuntimeEvent(request, completedToolCall)
      : createToolCallFailedRuntimeEvent(request, completedToolCall, result.error),
    createToolResultCreatedRuntimeEvent(request, result),
  );

  return {
    toolResult: options.repository.saveToolResult(result),
    runtimeEvents,
  };
}

function runtimeEventBase(request: ModelStepRuntimeRequest, eventId: string, createdAt: string) {
  return {
    eventId,
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    runtimeContext: request.runtimeContext,
    sequence: 1,
    createdAt,
  };
}

function createToolCallRequestedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
): RuntimeEvent {
  return createToolCallRequestedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:requested`, toolCall.requestedAt),
    eventType: 'tool.call.requested',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: { toolCall },
  });
}

function createToolCallPolicyDecidedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  decision: PermissionDecision,
): RuntimeEvent {
  return createToolCallPolicyDecidedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:policy-decided`, decision.evaluatedAt),
    eventType: 'tool.call.policy_decided',
    source: 'security',
    visibility: 'debug',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      policyDecision: decision,
    },
  });
}

function createPermissionDecisionCreatedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  decision: PermissionDecision,
): RuntimeEvent {
  return createPermissionDecisionCreatedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:permission-decision-created`, decision.evaluatedAt),
    eventType: 'permission.decision.created',
    source: 'security',
    visibility: 'debug',
    persist: 'required',
    payload: {
      permissionDecision: decision,
    },
  });
}

function createToolCallApprovalRequestedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  approvalRequest: ApprovalRequest,
): RuntimeEvent {
  return createToolCallApprovalRequestedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:approval-requested`, approvalRequest.createdAt),
    eventType: 'tool.call.approval_requested',
    source: 'approval',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      approvalRequest,
    },
  });
}

function createApprovalRequestedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  approvalRequest: ApprovalRequest,
): RuntimeEvent {
  return createApprovalRequestedEvent({
    ...runtimeEventBase(request, `event:${approvalRequest.approvalRequestId}:requested`, approvalRequest.createdAt),
    eventType: 'approval.requested',
    source: 'approval',
    visibility: 'user',
    persist: 'required',
    payload: { approvalRequest },
  });
}

function createToolCallStartedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
): RuntimeEvent {
  return createToolCallStartedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:started`, toolCall.startedAt ?? toolCall.requestedAt),
    eventType: 'tool.call.started',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      ...(toolCall.startedAt ? { startedAt: toolCall.startedAt } : {}),
    },
  });
}

function createToolCallCompletedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
): RuntimeEvent {
  return createToolCallCompletedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:completed`, toolCall.completedAt ?? toolCall.requestedAt),
    eventType: 'tool.call.completed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      ...(toolCall.completedAt ? { completedAt: toolCall.completedAt } : {}),
    },
  });
}

function createToolCallFailedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  error: RuntimeError | undefined,
): RuntimeEvent {
  return createToolCallFailedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:failed`, toolCall.completedAt ?? toolCall.requestedAt),
    eventType: 'tool.call.failed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      error: error ?? createToolRuntimeError('Tool execution failed.'),
      ...(toolCall.completedAt ? { completedAt: toolCall.completedAt } : {}),
    },
  });
}

function createToolCallDeniedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  reason: string,
): RuntimeEvent {
  return createToolCallDeniedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:denied`, toolCall.completedAt ?? toolCall.requestedAt),
    eventType: 'tool.call.denied',
    source: 'security',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolCallId: toolCall.toolCallId,
      reason,
    },
  });
}

function createToolResultCreatedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolResult: ToolResult,
): RuntimeEvent {
  return createToolResultCreatedEvent({
    ...runtimeEventBase(request, `event:${toolResult.toolResultId}:created`, toolResult.createdAt),
    eventType: 'tool.result.created',
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: toolResult.toolResultId,
      toolUseId: toolResult.toolUseId,
      ...(toolResult.toolCallId ? { toolCallId: toolResult.toolCallId } : {}),
      kind: toolResult.kind,
      summary: createToolResultSummary(toolResult),
    },
  });
}

function createToolRuntimeError(message: string): RuntimeError {
  return {
    code: 'runtime_unknown',
    message,
    severity: 'error',
    retryable: false,
    source: 'tool',
  };
}

function createApprovalRequest(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'ids' | 'now'>,
  request: ModelStepRuntimeRequest,
  toolUse: ToolUse,
  toolCall: ToolCall,
  decision: PermissionDecision,
): ApprovalRequest {
  return {
    approvalRequestId: options.ids.approvalRequestId(),
    toolUseId: toolUse.toolUseId,
    toolCallId: toolCall.toolCallId,
    permissionDecisionId: decision.permissionDecisionId,
    runId: toolCall.runId,
    stepId: request.stepId,
    toolName: toolCall.toolName,
    capabilities: toolCall.capabilities,
    riskLevel: decision.effectiveRiskLevel,
    title: `Approve ${toolCall.toolName}`,
    summary: decision.reason,
    preview: {
      action: toolUse.inputPreview.summary,
      targets: toolUse.inputPreview.targets,
      ...(toolUse.inputPreview.warnings ? { warnings: toolUse.inputPreview.warnings } : {}),
    },
    requestedScope: decision.requiredApproval?.scope ?? 'once',
    status: 'pending',
    createdAt: options.now(),
  };
}

function createToolResultSummary(toolResult: ToolResult): string {
  if (toolResult.textContent && toolResult.textContent.length > 0) {
    return toolResult.textContent;
  }

  if (toolResult.denialReason && toolResult.denialReason.length > 0) {
    return toolResult.denialReason;
  }

  if (toolResult.error) {
    return toolResult.error.message;
  }

  if (toolResult.structuredContent !== undefined) {
    return JSON.stringify(toolResult.structuredContent);
  }

  return toolResult.kind;
}

function saveDeniedResult(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolUse: ToolUse,
  toolCall: ToolCall,
  decision: PermissionDecision,
): ToolResult {
  options.repository.saveToolCall({
    ...toolCall,
    policyDecision: decision,
    status: 'denied',
    completedAt: options.now(),
  });

  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolUseId: toolUse.toolUseId,
    toolCallId: toolCall.toolCallId,
    runId: toolUse.runId,
    kind: 'policy_denied',
    textContent: decision.reason,
    denialReason: decision.reason,
    redactionState: 'none',
    createdAt: options.now(),
  });
}

function saveImmediateToolError(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolUse: ToolUse,
  message: string,
): ToolResult {
  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolUseId: toolUse.toolUseId,
    runId: toolUse.runId,
    kind: 'tool_error',
    textContent: message,
    denialReason: message,
    redactionState: 'none',
    createdAt: options.now(),
  });
}
