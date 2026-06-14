import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import {
  modelVisibleDefinitionForSnapshotEntry,
  resolveToolCallFromSnapshot,
} from '@megumi/tools/registry';
import { validateToolInput } from '@megumi/tools/validation';
import type { ToolRegistry } from '@megumi/tools/registry';
import type { JsonObject } from '@megumi/shared/primitives/json';
import type {
  PendingToolApproval,
  ToolApprovalResumeInput,
  ToolApprovalResumeOutcome,
  ToolApprovalResumePort,
  ToolCallHandlerPort,
} from '@megumi/core/agent-runtime';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { MergedPermissionSettings } from '@megumi/shared/permission';
import type { PermissionMode } from '@megumi/shared/permission';
import {
  createApprovalRequestedEvent,
  createPermissionDecisionCreatedEvent,
  createToolCallResolvedEvent,
  createToolCallResolutionFailedEvent,
  createToolExecutionApprovalRequestedEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionDeniedEvent,
  createToolExecutionFailedEvent,
  createToolExecutionPolicyDecidedEvent,
  createToolExecutionRequestedEvent,
  createToolExecutionRoutedEvent,
  createToolExecutionStartedEvent,
  createToolInputValidationFailedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolRegistrySnapshot,
  ToolResult,
  ToolSourceIdentity,
} from '@megumi/shared/tool';
import type {
  ToolExecutionRouter,
  ToolExecutionRouting,
} from './tool-execution-router.service';
import type { WorkspaceChangeExecutionScope } from '../workspace/workspace-change-tracker.service';

export interface ToolCallHandlerRepositoryPort {
  saveToolCall(toolCall: ToolCall): ToolCall;
  getToolCall(toolCallId: string): ToolCall | undefined;
  saveToolExecution(toolExecution: ToolExecution): ToolExecution;
  getToolExecution(toolExecutionId: string): ToolExecution | undefined;
  savePermissionDecision(permissionDecision: PermissionDecision): PermissionDecision;
  saveApprovalRequest(approvalRequest: ApprovalRequest): ApprovalRequest;
  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined;
  saveToolResult(toolResult: ToolResult): ToolResult;
  getRunSessionId(runId: string): string | undefined;
  getToolRegistrySnapshotByRun(runId: string): ToolRegistrySnapshot | undefined;
}

export interface ToolCallHandlerServiceOptions {
  registry: ToolRegistry;
  repository: ToolCallHandlerRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  toolExecutionRouter: ToolExecutionRouter;
  now?: () => string;
  ids?: {
    toolExecutionId(): string;
    toolResultId(): string;
    permissionDecisionId(): string;
    approvalRequestId(): string;
  };
}

interface ResolvedToolCallHandlerServiceOptions extends ToolCallHandlerServiceOptions {
  now: () => string;
  ids: NonNullable<ToolCallHandlerServiceOptions['ids']>;
}

interface SingleToolCallOutcome {
  toolResult?: ToolResult;
  pendingApproval?: PendingToolApproval;
  runtimeEvents?: RuntimeEvent[];
  executedTool?: boolean;
}

export function createToolCallHandlerService(
  options: ToolCallHandlerServiceOptions,
): ToolCallHandlerPort & ToolApprovalResumePort {
  const resolvedOptions: ResolvedToolCallHandlerServiceOptions = {
    ...options,
    now: options.now ?? (() => new Date().toISOString()),
    ids: options.ids ?? {
      toolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
      toolResultId: () => `tool-result:${crypto.randomUUID()}`,
      permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
      approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
    },
  };

  return {
    async handleToolCalls(input) {
      const toolResults: ToolResult[] = [];
      const pendingApprovals: PendingToolApproval[] = [];
      const runtimeEvents: RuntimeEvent[] = [];
      let executedToolCount = 0;
      const workspaceChangeScope: WorkspaceChangeExecutionScope = {
        sessionId: String(input.request.sessionId),
        runId: String(input.request.runId),
        stepId: String(input.request.stepId),
      };
      const snapshot = resolvedOptions.repository.getToolRegistrySnapshotByRun(String(input.request.runId));
      if (!snapshot) {
        throw createToolRegistrySnapshotMissingError(String(input.request.runId));
      }

      for (const toolCall of input.toolCalls) {
        const outcome = await handleSingleToolCall(
          resolvedOptions,
          input.request,
          snapshot,
          toolCall,
          workspaceChangeScope,
        );
        if (outcome.toolResult) {
          toolResults.push(outcome.toolResult);
        }
        if (outcome.pendingApproval) {
          pendingApprovals.push(outcome.pendingApproval);
        }
        if (outcome.executedTool) {
          executedToolCount += 1;
        }
        runtimeEvents.push(...(outcome.runtimeEvents ?? []));
      }

      if (executedToolCount > 0) {
        resolvedOptions.toolExecutionRouter.finalizeWorkspaceChangeSet?.(workspaceChangeScope);
      }

      return { toolResults, pendingApprovals, runtimeEvents };
    },
    async resumeToolApproval(input) {
      return resumeToolApproval(resolvedOptions, input);
    },
  };
}

async function resumeToolApproval(
  options: ResolvedToolCallHandlerServiceOptions,
  input: ToolApprovalResumeInput,
): Promise<ToolApprovalResumeOutcome | undefined> {
  const approvalRequest = options.repository.getApprovalRequest(input.approvalRequestId);
  if (!approvalRequest) {
    return undefined;
  }

  const toolExecution = options.repository.getToolExecution(approvalRequest.toolExecutionId);
  if (!toolExecution) {
    return undefined;
  }

  if (input.decision === 'denied') {
    options.repository.saveApprovalRequest({
      ...approvalRequest,
      status: input.decision,
      resolvedAt: input.decidedAt,
    });

    const deniedToolExecution = options.repository.saveToolExecution({
      ...toolExecution,
      status: 'denied',
      completedAt: input.decidedAt,
    });

    const toolResult = options.repository.saveToolResult({
      toolResultId: options.ids.toolResultId(),
      toolCallId: deniedToolExecution.toolCallId,
      toolExecutionId: deniedToolExecution.toolExecutionId,
      runId: deniedToolExecution.runId,
      kind: 'user_rejected',
      textContent: input.reason ?? 'User rejected the requested tool execution.',
      denialReason: input.reason ?? 'User rejected the requested tool execution.',
      redactionState: 'none',
      createdAt: input.decidedAt,
      metadata: metadataWithSourceIdentity(undefined, sourceIdentityFromRecord(deniedToolExecution)),
    });
    return {
      toolResult,
      runtimeEvents: [
        createToolExecutionDeniedRuntimeEventFromToolExecution(
          deniedToolExecution,
          toolResult.denialReason ?? toolResult.textContent ?? 'User rejected the requested tool execution.',
        ),
        createToolResultCreatedRuntimeEventFromToolResult(toolResult),
      ],
    };
  }

  const sessionId = options.repository.getRunSessionId(String(toolExecution.runId));
  if (!sessionId) {
    return undefined;
  }
  options.repository.saveApprovalRequest({
    ...approvalRequest,
    status: input.decision,
    resolvedAt: input.decidedAt,
  });

  const runningToolExecution = options.repository.saveToolExecution({
    ...toolExecution,
    status: 'running',
    startedAt: input.decidedAt,
  });
  const workspaceChangeScope: WorkspaceChangeExecutionScope = {
    sessionId,
    runId: String(runningToolExecution.runId),
    stepId: String(runningToolExecution.stepId),
  };
  const routedResult = await options.toolExecutionRouter.executeToolExecution(
    runningToolExecution,
    workspaceChangeScope,
  );
  const toolResult = withToolResultSourceIdentity(routedResult.toolResult, sourceIdentityFromRecord(runningToolExecution));

  const completedToolExecution = options.repository.saveToolExecution({
    ...runningToolExecution,
    status: toolResult.kind === 'success' || toolResult.kind === 'redacted' ? 'completed' : 'failed',
    completedAt: toolResult.createdAt,
    resultPreview: toolResult.textContent,
    ...(toolResult.error ? { error: toolResult.error } : {}),
  });

  const savedToolResult = options.repository.saveToolResult(toolResult);
  options.toolExecutionRouter.finalizeWorkspaceChangeSet?.(workspaceChangeScope);
  return {
    toolResult: savedToolResult,
    runtimeEvents: [
      createToolExecutionStartedRuntimeEventFromToolExecution(runningToolExecution),
      ...(routedResult.routed
        ? [createToolExecutionRoutedRuntimeEventFromRouting(
          runningToolExecution,
          routedResult.routing,
          runningToolExecution.startedAt ?? toolResult.createdAt,
        )]
        : []),
      toolResult.kind === 'success' || toolResult.kind === 'redacted'
        ? createToolExecutionCompletedRuntimeEventFromToolExecution(completedToolExecution)
        : createToolExecutionFailedRuntimeEventFromToolExecution(completedToolExecution, toolResult.error),
      createToolResultCreatedRuntimeEventFromToolResult(savedToolResult),
    ],
  };
}

async function handleSingleToolCall(
  options: ResolvedToolCallHandlerServiceOptions,
  request: ModelStepRuntimeRequest,
  snapshot: ToolRegistrySnapshot,
  toolCall: ToolCall,
  workspaceChangeScope: WorkspaceChangeExecutionScope,
): Promise<SingleToolCallOutcome> {
  const resolution = resolveToolCallFromSnapshot(snapshot, toolCall.toolName);
  if (!resolution.ok) {
    const failedToolCall = options.repository.saveToolCall({
      ...toolCall,
      ...(resolution.sourceIdentity ?? {}),
      status: 'failed',
      completedAt: options.now(),
      error: createToolRuntimeError(resolution.message),
      metadata: metadataWithSourceIdentity(
        { resolutionReason: resolution.reason },
        resolution.sourceIdentity,
      ),
    });
    const toolResult = saveImmediateToolError(
      options,
      failedToolCall,
      resolution.message,
      'invalid_tool_call',
      resolution.sourceIdentity,
      { error: 'invalid_tool_call', reason: resolution.reason, message: resolution.message },
    );
    return {
      toolResult,
      runtimeEvents: [
        createToolCallResolutionFailedRuntimeEvent(
          request,
          failedToolCall,
          resolution.reason,
          resolution.message,
          resolution.sourceIdentity,
        ),
        createToolResultCreatedRuntimeEvent(request, toolResult),
      ],
    };
  }

  const sourceIdentity = resolution.sourceIdentity;
  const definition = modelVisibleDefinitionForSnapshotEntry(resolution.entry);
  const resolvedToolCall: ToolCall = {
    ...toolCall,
    ...sourceIdentity,
  };
  const runtimeEvents: RuntimeEvent[] = [
    createToolCallResolvedRuntimeEvent(request, resolvedToolCall, sourceIdentity),
  ];

  const validation = validateToolInput(definition, resolvedToolCall.input);
  if (!validation.ok) {
    const failedToolCall = options.repository.saveToolCall({
      ...resolvedToolCall,
      status: 'failed',
      completedAt: options.now(),
      error: createToolRuntimeError(validation.errorMessage),
      metadata: metadataWithSourceIdentity(
        { validationReason: 'invalid_tool_input' },
        sourceIdentity,
      ),
    });
    const toolResult = saveImmediateToolError(
      options,
      failedToolCall,
      validation.errorMessage,
      'invalid_tool_input',
      sourceIdentity,
      { error: 'invalid_tool_input', message: validation.errorMessage },
    );
    runtimeEvents.push(
      createToolInputValidationFailedRuntimeEvent(request, failedToolCall, sourceIdentity, validation.errorMessage),
      createToolResultCreatedRuntimeEvent(request, toolResult),
    );
    return {
      toolResult,
      runtimeEvents,
    };
  }

  const savedToolCall = options.repository.saveToolCall({
    ...resolvedToolCall,
    toolName: definition.name,
    status: 'validated',
  });

  const requestedToolExecution = options.repository.saveToolExecution({
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: savedToolCall.toolCallId,
    runId: savedToolCall.runId,
    stepId: request.stepId,
    toolName: definition.name,
    ...sourceIdentity,
    input: savedToolCall.input,
    inputPreview: savedToolCall.inputPreview,
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'pending_approval',
    requestedAt: options.now(),
  });
  runtimeEvents.push(createToolExecutionRequestedRuntimeEvent(request, requestedToolExecution));

  const evaluatedDecision = evaluatePermissionPolicy({
    definition,
    toolExecution: requestedToolExecution,
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
    createToolExecutionPolicyDecidedRuntimeEvent(request, requestedToolExecution, decision),
    createPermissionDecisionCreatedRuntimeEvent(request, decision),
  );

  if (decision.decision === 'deny') {
    const toolResult = saveDeniedResult(options, requestedToolExecution, decision);
    runtimeEvents.push(
      createToolExecutionDeniedRuntimeEvent(request, requestedToolExecution, decision.reason),
      createToolResultCreatedRuntimeEvent(request, toolResult),
    );
    return {
      toolResult,
      runtimeEvents,
    };
  }

  if (decision.decision === 'ask') {
    const approvalRequest = options.repository.saveApprovalRequest(
      createApprovalRequest(options, request, savedToolCall, requestedToolExecution, decision),
    );
    const waitingToolExecution = options.repository.saveToolExecution({
      ...requestedToolExecution,
      policyDecision: decision,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'pending_approval',
    });
    runtimeEvents.push(
      createToolExecutionApprovalRequestedRuntimeEvent(request, waitingToolExecution, approvalRequest),
      createApprovalRequestedRuntimeEvent(request, approvalRequest),
    );
    return {
      pendingApproval: { approvalRequest, toolCall: savedToolCall, toolExecution: waitingToolExecution },
      runtimeEvents,
    };
  }

  const runningToolExecution = options.repository.saveToolExecution({
    ...requestedToolExecution,
    policyDecision: decision,
    sandboxRequirement: decision.requiredSandbox,
    status: 'running',
    startedAt: options.now(),
  });
  runtimeEvents.push(createToolExecutionStartedRuntimeEvent(request, runningToolExecution));
  const routedResult = await options.toolExecutionRouter.executeToolExecution(
    runningToolExecution,
    workspaceChangeScope,
  );
  const result = withToolResultSourceIdentity(routedResult.toolResult, sourceIdentity);
  if (routedResult.routed) {
    runtimeEvents.push(createToolExecutionRoutedRuntimeEvent(
      request,
      routedResult.routing,
      runningToolExecution.startedAt ?? result.createdAt,
    ));
  }
  const completedToolExecution = options.repository.saveToolExecution({
    ...runningToolExecution,
    status: result.kind === 'success' || result.kind === 'redacted' ? 'completed' : 'failed',
    completedAt: result.createdAt,
    resultPreview: result.textContent,
    ...(result.error ? { error: result.error } : {}),
  });
  runtimeEvents.push(
    result.kind === 'success' || result.kind === 'redacted'
      ? createToolExecutionCompletedRuntimeEvent(request, completedToolExecution)
      : createToolExecutionFailedRuntimeEvent(request, completedToolExecution, result.error),
    createToolResultCreatedRuntimeEvent(request, result),
  );

  return {
    toolResult: options.repository.saveToolResult(result),
    executedTool: true,
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

function runtimeEventBaseForToolExecution(toolExecution: ToolExecution, eventId: string, createdAt: string) {
  return {
    eventId,
    runId: toolExecution.runId,
    stepId: String(toolExecution.stepId),
    sequence: 1,
    createdAt,
  };
}

function runtimeEventBaseForToolResult(toolResult: ToolResult, eventId: string) {
  return {
    eventId,
    runId: toolResult.runId,
    sequence: 1,
    createdAt: toolResult.createdAt,
  };
}

function createToolExecutionRequestedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
): RuntimeEvent {
  return createToolExecutionRequestedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:requested`, toolExecution.requestedAt),
    eventType: 'tool.execution.requested',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: { toolExecution },
  });
}

function createToolExecutionPolicyDecidedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
  decision: PermissionDecision,
): RuntimeEvent {
  return createToolExecutionPolicyDecidedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:policy-decided`, decision.evaluatedAt),
    eventType: 'tool.execution.policy_decided',
    source: 'security',
    visibility: 'debug',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      toolName: toolExecution.toolName,
      policyDecision: decision,
    },
  });
}

function createPermissionDecisionCreatedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  decision: PermissionDecision,
): RuntimeEvent {
  return createPermissionDecisionCreatedEvent({
    ...runtimeEventBase(request, `event:${decision.permissionDecisionId}:permission-decision-created`, decision.evaluatedAt),
    eventType: 'permission.decision.created',
    source: 'security',
    visibility: 'debug',
    persist: 'required',
    payload: {
      permissionDecision: decision,
    },
  });
}

function createToolExecutionApprovalRequestedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
  approvalRequest: ApprovalRequest,
): RuntimeEvent {
  return createToolExecutionApprovalRequestedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:approval-requested`, approvalRequest.createdAt),
    eventType: 'tool.execution.approval_requested',
    source: 'approval',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      toolName: toolExecution.toolName,
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

function createToolExecutionStartedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
): RuntimeEvent {
  return createToolExecutionStartedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:started`, toolExecution.startedAt ?? toolExecution.requestedAt),
    eventType: 'tool.execution.started',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      ...(toolExecution.startedAt ? { startedAt: toolExecution.startedAt } : {}),
    },
  });
}

function createToolExecutionStartedRuntimeEventFromToolExecution(toolExecution: ToolExecution): RuntimeEvent {
  return createToolExecutionStartedEvent({
    ...runtimeEventBaseForToolExecution(
      toolExecution,
      `event:${toolExecution.toolExecutionId}:started`,
      toolExecution.startedAt ?? toolExecution.requestedAt,
    ),
    eventType: 'tool.execution.started',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      ...(toolExecution.startedAt ? { startedAt: toolExecution.startedAt } : {}),
    },
  });
}

function createToolExecutionRoutedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  routing: ToolExecutionRouting,
  createdAt: string,
): RuntimeEvent {
  return createToolExecutionRoutedEvent({
    ...runtimeEventBase(request, `event:${routing.toolExecutionId}:routed`, createdAt),
    payload: routing,
  });
}

function createToolExecutionRoutedRuntimeEventFromRouting(
  toolExecution: ToolExecution,
  routing: ToolExecutionRouting,
  createdAt: string,
): RuntimeEvent {
  return createToolExecutionRoutedEvent({
    ...runtimeEventBaseForToolExecution(toolExecution, `event:${routing.toolExecutionId}:routed`, createdAt),
    payload: routing,
  });
}

function createToolExecutionCompletedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
): RuntimeEvent {
  return createToolExecutionCompletedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:completed`, toolExecution.completedAt ?? toolExecution.requestedAt),
    eventType: 'tool.execution.completed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      ...(toolExecution.completedAt ? { completedAt: toolExecution.completedAt } : {}),
    },
  });
}

function createToolExecutionCompletedRuntimeEventFromToolExecution(toolExecution: ToolExecution): RuntimeEvent {
  return createToolExecutionCompletedEvent({
    ...runtimeEventBaseForToolExecution(
      toolExecution,
      `event:${toolExecution.toolExecutionId}:completed`,
      toolExecution.completedAt ?? toolExecution.requestedAt,
    ),
    eventType: 'tool.execution.completed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      ...(toolExecution.completedAt ? { completedAt: toolExecution.completedAt } : {}),
    },
  });
}

function createToolExecutionFailedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
  error: RuntimeError | undefined,
): RuntimeEvent {
  return createToolExecutionFailedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:failed`, toolExecution.completedAt ?? toolExecution.requestedAt),
    eventType: 'tool.execution.failed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      error: error ?? createToolRuntimeError('Tool execution failed.'),
      ...(toolExecution.completedAt ? { completedAt: toolExecution.completedAt } : {}),
    },
  });
}

function createToolExecutionFailedRuntimeEventFromToolExecution(
  toolExecution: ToolExecution,
  error: RuntimeError | undefined,
): RuntimeEvent {
  return createToolExecutionFailedEvent({
    ...runtimeEventBaseForToolExecution(
      toolExecution,
      `event:${toolExecution.toolExecutionId}:failed`,
      toolExecution.completedAt ?? toolExecution.requestedAt,
    ),
    eventType: 'tool.execution.failed',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      error: error ?? createToolRuntimeError('Tool execution failed.'),
      ...(toolExecution.completedAt ? { completedAt: toolExecution.completedAt } : {}),
    },
  });
}

function createToolExecutionDeniedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolExecution: ToolExecution,
  reason: string,
): RuntimeEvent {
  return createToolExecutionDeniedEvent({
    ...runtimeEventBase(request, `event:${toolExecution.toolExecutionId}:denied`, toolExecution.completedAt ?? toolExecution.requestedAt),
    eventType: 'tool.execution.denied',
    source: 'security',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
      reason,
    },
  });
}

function createToolExecutionDeniedRuntimeEventFromToolExecution(
  toolExecution: ToolExecution,
  reason: string,
): RuntimeEvent {
  return createToolExecutionDeniedEvent({
    ...runtimeEventBaseForToolExecution(
      toolExecution,
      `event:${toolExecution.toolExecutionId}:denied`,
      toolExecution.completedAt ?? toolExecution.requestedAt,
    ),
    eventType: 'tool.execution.denied',
    source: 'security',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId: toolExecution.toolExecutionId,
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
      toolCallId: toolResult.toolCallId,
      ...(toolResult.toolExecutionId ? { toolExecutionId: toolResult.toolExecutionId } : {}),
      kind: toolResult.kind,
      summary: createToolResultSummary(toolResult),
      ...(sourceIdentityFromToolResult(toolResult) ? { sourceIdentity: sourceIdentityFromToolResult(toolResult) } : {}),
    },
  });
}

function createToolResultCreatedRuntimeEventFromToolResult(toolResult: ToolResult): RuntimeEvent {
  return createToolResultCreatedEvent({
    ...runtimeEventBaseForToolResult(toolResult, `event:${toolResult.toolResultId}:created`),
    eventType: 'tool.result.created',
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: toolResult.toolResultId,
      toolCallId: toolResult.toolCallId,
      ...(toolResult.toolExecutionId ? { toolExecutionId: toolResult.toolExecutionId } : {}),
      kind: toolResult.kind,
      summary: createToolResultSummary(toolResult),
      ...(sourceIdentityFromToolResult(toolResult) ? { sourceIdentity: sourceIdentityFromToolResult(toolResult) } : {}),
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
  options: Pick<ResolvedToolCallHandlerServiceOptions, 'ids' | 'now'>,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  toolExecution: ToolExecution,
  decision: PermissionDecision,
): ApprovalRequest {
  return {
    approvalRequestId: options.ids.approvalRequestId(),
    toolCallId: toolCall.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    permissionDecisionId: decision.permissionDecisionId,
    runId: toolExecution.runId,
    stepId: request.stepId,
    toolName: toolExecution.toolName,
    ...sourceIdentityFromRecord(toolExecution),
    capabilities: toolExecution.capabilities,
    riskLevel: decision.effectiveRiskLevel,
    title: `Approve ${toolExecution.toolName}`,
    summary: decision.reason,
    preview: {
      action: toolCall.inputPreview.summary,
      targets: toolCall.inputPreview.targets,
      ...(toolCall.inputPreview.warnings ? { warnings: toolCall.inputPreview.warnings } : {}),
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
  options: Pick<ResolvedToolCallHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolExecution: ToolExecution,
  decision: PermissionDecision,
): ToolResult {
  options.repository.saveToolExecution({
    ...toolExecution,
    policyDecision: decision,
    status: 'denied',
    completedAt: options.now(),
  });

  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolCallId: toolExecution.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolExecution.runId,
    kind: 'policy_denied',
    textContent: decision.reason,
    denialReason: decision.reason,
    redactionState: 'none',
    createdAt: options.now(),
    metadata: metadataWithSourceIdentity(undefined, sourceIdentityFromRecord(toolExecution)),
  });
}

function saveImmediateToolError(
  options: Pick<ResolvedToolCallHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolCall: ToolCall,
  message: string,
  kind: 'invalid_tool_call' | 'invalid_tool_input' | 'tool_error' = 'tool_error',
  sourceIdentity?: ToolSourceIdentity,
  structuredContent?: JsonObject,
): ToolResult {
  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    kind,
    ...(structuredContent ? { structuredContent } : {}),
    textContent: message,
    denialReason: message,
    redactionState: 'none',
    createdAt: options.now(),
    metadata: metadataWithSourceIdentity(undefined, sourceIdentity),
  });
}

function createToolCallResolvedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  sourceIdentity: ToolSourceIdentity,
): RuntimeEvent {
  return createToolCallResolvedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:resolved`, toolCall.createdAt),
    payload: {
      toolCallId: String(toolCall.toolCallId),
      providerToolCallId: toolCall.providerToolCallId,
      requestedToolName: toolCall.toolName,
      ...sourceIdentity,
    },
  });
}

function createToolCallResolutionFailedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  reason: 'unknown_tool' | 'tool_disabled' | 'tool_unavailable' | 'tool_conflicted' | 'tool_not_exposed',
  message: string,
  sourceIdentity?: ToolSourceIdentity,
): RuntimeEvent {
  return createToolCallResolutionFailedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:resolution-failed`, toolCall.completedAt ?? toolCall.createdAt),
    payload: {
      toolCallId: String(toolCall.toolCallId),
      providerToolCallId: toolCall.providerToolCallId,
      requestedToolName: toolCall.toolName,
      reason,
      message,
      ...(sourceIdentity ? { sourceIdentity } : {}),
    },
  });
}

function createToolInputValidationFailedRuntimeEvent(
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  sourceIdentity: ToolSourceIdentity,
  message: string,
): RuntimeEvent {
  return createToolInputValidationFailedEvent({
    ...runtimeEventBase(request, `event:${toolCall.toolCallId}:input-validation-failed`, toolCall.completedAt ?? toolCall.createdAt),
    payload: {
      toolCallId: String(toolCall.toolCallId),
      modelVisibleName: sourceIdentity.modelVisibleName,
      registrySnapshotId: sourceIdentity.registrySnapshotId,
      snapshotEntryId: sourceIdentity.snapshotEntryId,
      reason: 'invalid_tool_input',
      message,
      sourceIdentity,
    },
  });
}

function createToolRegistrySnapshotMissingError(runId: string): RuntimeError & Error {
  return Object.assign(new Error(`Tool registry snapshot is missing for run ${runId}.`), {
    code: 'tool_registry_snapshot_missing' as const,
    severity: 'error' as const,
    retryable: false,
    source: 'tool' as const,
  });
}

function withToolResultSourceIdentity(toolResult: ToolResult, sourceIdentity?: ToolSourceIdentity): ToolResult {
  if (!sourceIdentity) {
    return toolResult;
  }

  return {
    ...toolResult,
    metadata: metadataWithSourceIdentity(toolResult.metadata, sourceIdentity),
  };
}

function metadataWithSourceIdentity(
  metadata: JsonObject | undefined,
  sourceIdentity: ToolSourceIdentity | undefined,
): JsonObject | undefined {
  if (!sourceIdentity) {
    return metadata;
  }

  return {
    ...(metadata ?? {}),
    toolSourceIdentity: sourceIdentity,
  };
}

function sourceIdentityFromRecord(record: Partial<ToolSourceIdentity>): ToolSourceIdentity | undefined {
  if (
    typeof record.registrySnapshotId !== 'string'
    || typeof record.snapshotEntryId !== 'string'
    || typeof record.modelVisibleName !== 'string'
    || typeof record.canonicalToolId !== 'string'
    || typeof record.sourceId !== 'string'
    || typeof record.namespace !== 'string'
    || typeof record.sourceToolName !== 'string'
  ) {
    return undefined;
  }

  return {
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
  };
}

function sourceIdentityFromToolResult(toolResult: ToolResult): ToolSourceIdentity | undefined {
  const value = toolResult.metadata?.toolSourceIdentity;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return sourceIdentityFromRecord(value);
}



