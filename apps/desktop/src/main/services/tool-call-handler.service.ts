import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import { validateToolInput } from '@megumi/tools/validation';
import type { ToolRegistry } from '@megumi/tools/registry';
import type {
  PendingToolApproval,
  ToolApprovalResumeInput,
  ToolApprovalResumeOutcome,
  ToolApprovalResumePort,
  ToolCallHandlerPort,
} from '@megumi/core/run-runtime/tool-loop';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { MergedPermissionSettings } from '@megumi/shared/permission-settings-contracts';
import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import {
  createApprovalRequestedEvent,
  createPermissionDecisionCreatedEvent,
  createToolExecutionApprovalRequestedEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionDeniedEvent,
  createToolExecutionFailedEvent,
  createToolExecutionPolicyDecidedEvent,
  createToolExecutionRequestedEvent,
  createToolExecutionStartedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolResult,
} from '@megumi/shared/tool-contracts';
import type { ProjectToolExecutor } from './project-tool-executor.service';
import type { WorkspaceChangeExecutionScope } from './workspace-change-tracker.service';

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
}

export interface ToolCallHandlerServiceOptions {
  registry: ToolRegistry;
  repository: ToolCallHandlerRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  projectExecutor: ProjectToolExecutor;
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

      for (const toolCall of input.toolCalls) {
        resolvedOptions.repository.saveToolCall(toolCall);
        const outcome = await handleSingleToolCall(
          resolvedOptions,
          input.request,
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

      if (executedToolCount > 0 && pendingApprovals.length === 0) {
        resolvedOptions.projectExecutor.finalizeWorkspaceChangeSet?.(workspaceChangeScope);
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
  const toolResult = await options.projectExecutor.executeToolExecution(
    runningToolExecution,
    workspaceChangeScope,
  );

  const completedToolExecution = options.repository.saveToolExecution({
    ...runningToolExecution,
    status: toolResult.kind === 'success' ? 'completed' : 'failed',
    completedAt: toolResult.createdAt,
    resultPreview: toolResult.textContent,
    ...(toolResult.error ? { error: toolResult.error } : {}),
  });

  const savedToolResult = options.repository.saveToolResult(toolResult);
  options.projectExecutor.finalizeWorkspaceChangeSet?.(workspaceChangeScope);
  return {
    toolResult: savedToolResult,
    runtimeEvents: [
      createToolExecutionStartedRuntimeEventFromToolExecution(runningToolExecution),
      toolResult.kind === 'success'
        ? createToolExecutionCompletedRuntimeEventFromToolExecution(completedToolExecution)
        : createToolExecutionFailedRuntimeEventFromToolExecution(completedToolExecution, toolResult.error),
      createToolResultCreatedRuntimeEventFromToolResult(savedToolResult),
    ],
  };
}

async function handleSingleToolCall(
  options: ResolvedToolCallHandlerServiceOptions,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  workspaceChangeScope: WorkspaceChangeExecutionScope,
): Promise<SingleToolCallOutcome> {
  const definition = options.registry.getDefinition(toolCall.toolName, {
    runId: String(request.runId),
    permissionMode: options.permissionMode,
    providerCapabilitySummary: { supportsToolCall: true },
  });

  if (!definition) {
    return {
      toolResult: saveImmediateToolError(options, toolCall, `Unknown tool: ${toolCall.toolName}`),
    };
  }

  const validation = validateToolInput(definition, toolCall.input);
  if (!validation.ok) {
    return {
      toolResult: saveImmediateToolError(options, toolCall, validation.errorMessage),
    };
  }

  const requestedToolExecution = options.repository.saveToolExecution({
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    stepId: request.stepId,
    toolName: definition.name,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'pending_approval',
    requestedAt: options.now(),
  });
  const runtimeEvents: RuntimeEvent[] = [
    createToolExecutionRequestedRuntimeEvent(request, requestedToolExecution),
  ];

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
      createApprovalRequest(options, request, toolCall, requestedToolExecution, decision),
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
      pendingApproval: { approvalRequest, toolCall, toolExecution: waitingToolExecution },
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
  const result = await options.projectExecutor.executeToolExecution(
    runningToolExecution,
    workspaceChangeScope,
  );
  const completedToolExecution = options.repository.saveToolExecution({
    ...runningToolExecution,
    status: result.kind === 'success' ? 'completed' : 'failed',
    completedAt: result.createdAt,
    resultPreview: result.textContent,
    ...(result.error ? { error: result.error } : {}),
  });
  runtimeEvents.push(
    result.kind === 'success'
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
  });
}

function saveImmediateToolError(
  options: Pick<ResolvedToolCallHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolCall: ToolCall,
  message: string,
): ToolResult {
  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    kind: 'tool_error',
    textContent: message,
    denialReason: message,
    redactionState: 'none',
    createdAt: options.now(),
  });
}
