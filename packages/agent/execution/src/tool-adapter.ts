/*
 * Adapts Tool Route, Permissions, Approval and real Tool execution to the
 * provider-neutral AgentTool seam. Approval waits happen inside the original
 * AgentTool.execute() Promise: the Agent Loop stays parked in executing_tools
 * and resumes exactly where it left off, never through a second continue().
 */
import type {
  AgentError,
  AgentTool,
  AgentToolExecutionOutcome,
  AgentToolResult,
} from '@megumi/agent-core';
import type { JsonValue } from '@megumi/ai';
import type { EventBus } from '@megumi/events';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import type {
  ApprovalDecision,
  ApprovalSubject,
  PermissionDecision,
  PermissionMode,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type {
  ToolDefinition,
  ToolExecutionAccess,
  ToolExecutionNotification,
  ToolIdentity,
  ToolInvocation,
  ModelCallToolBinding,
} from '@megumi/tools';
import type {
  ApprovalRequest,
  ApprovalResolution,
  ConversationExecutionMetadata,
  ExecutionClock,
  ExecutionMetadata,
} from './execution-registry';
import type { SessionToolResultCommit } from './session-settlement';
import type { ToolScope } from './context-adapter';

export type AgentToolUpdateDetails =
  | {
      readonly kind: 'execution_started';
      readonly toolExecutionId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | { readonly kind: 'output'; readonly output: string }
  | { readonly kind: 'plan_updated'; readonly notification: ToolExecutionNotification };

export interface AgentToolResultDetails {
  readonly kind: 'settled';
  readonly status: SessionToolResultCommit['status'];
  readonly content: string;
  readonly completedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly summary?: string;
  readonly toolExecutionId?: string;
}

export interface ToolAdapterDependencies {
  readonly metadata: ConversationExecutionMetadata;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly ids: { createToolExecutionId(): string; createApprovalId(): string };
  readonly clock: ExecutionClock;
  readonly events: EventBus;
  /** The Discovery Agent's approval wait seam; the original ToolCall Promise awaits it in place. */
  readonly awaitApproval: (request: { readonly approval: ApprovalRequest }) => Promise<ApprovalResolution>;
  readonly toolSystemFailures: Map<string, AgentError>;
  readonly observability?: Observability;
}

export function createAgentTool(
  dependencies: ToolAdapterDependencies,
): (definition: ToolDefinition, scope: ToolScope) => AgentTool<AgentToolResultDetails> {
  return (definition, scope) => ({
    // Preserve Context-facing Tool guidance metadata on the runtime object;
    // Agent Core and provider adapters consume only the AgentTool contract.
    ...definition,
    parameters: definition.parameters as AgentTool['parameters'],
    executionMode: definition.executionMode === 'serial' ? 'sequential' : 'parallel',
    execute: (input) => observeToolCall(
      dependencies.observability,
      dependencies.metadata,
      scope.modelCallId,
      input.toolCallId,
      () => executeProtectedAgentTool(definition, scope, input, dependencies),
    ),
  });
}

async function executeProtectedAgentTool(
  definition: ToolDefinition,
  scope: ToolScope,
  input: Parameters<AgentTool<AgentToolResultDetails>['execute']>[0],
  dependencies: ToolAdapterDependencies,
): Promise<AgentToolExecutionOutcome<AgentToolResultDetails>> {
  const correlation = toolCorrelation(
    dependencies.metadata,
    scope.modelCallId,
    input.toolCallId,
  );
  safeRecordToolContent(dependencies.observability, 'tool.request', {
    toolCallId: input.toolCallId,
    toolName: definition.name,
    arguments: input.arguments,
  }, correlation);
  const routed = scope.binding.routeToolCall({
    toolCallId: input.toolCallId,
    toolName: definition.name,
    input: input.arguments,
  });
  if (routed.status === 'failed') {
    return recordToolResult(dependencies.observability, correlation, completedToolOutcome(settledToolResult({
      status: 'failure',
      content: routed.error.message,
      completedAt: dependencies.clock.now(),
      error: routed.error,
    })));
  }
  safeRecordToolContent(
    dependencies.observability,
    'tool.arguments',
    routed.invocation.input,
    correlation,
  );
  const outcome = await executeRoutedTool(
    routed.invocation,
    routed.operations,
    input.signal,
    input.onUpdate as (update: AgentToolResult) => void,
    dependencies,
    scope.binding,
  );
  return recordToolResult(dependencies.observability, correlation, outcome);
}

/**
 * Adapts an operations-free Tool binding to Agent Core. Background Agents use
 * the same Router and executor as Session executions, but have no Approval UI.
 */
export function createUnprotectedAgentTool(
  definition: ToolDefinition,
  binding: ModelCallToolBinding,
  trace?: { readonly observability?: Observability; readonly metadata: ExecutionMetadata },
): AgentTool {
  return {
    ...definition,
    parameters: definition.parameters as AgentTool['parameters'],
    executionMode: definition.executionMode === 'serial' ? 'sequential' : 'parallel',
    execute: (input) => observeToolCall(
      trace?.observability,
      trace?.metadata,
      binding.modelCallId,
      input.toolCallId,
      async () => {
        const { toolCallId, arguments: argumentsValue, signal } = input;
        const correlation = trace?.metadata
          ? toolCorrelation(trace.metadata, binding.modelCallId, toolCallId)
          : { modelCallId: binding.modelCallId, toolCallId };
        safeRecordToolContent(trace?.observability, 'tool.request', {
          toolCallId,
          toolName: definition.name,
          arguments: argumentsValue,
        }, correlation);
        const routed = binding.routeToolCall({
          toolCallId,
          toolName: definition.name,
          input: argumentsValue,
        });
        if (routed.status === 'failed') {
          return recordToolResult(trace?.observability, correlation, completedToolOutcome({
            content: [{ type: 'text', text: routed.error.message }],
            isError: true,
          }));
        }
        safeRecordToolContent(trace?.observability, 'tool.arguments', routed.invocation.input, correlation);
        if (routed.operations.length > 0) {
          return recordToolResult(trace?.observability, correlation, {
            status: 'system_failed',
            error: {
              code: 'tool_system_failed',
              message: `Background Tool requires unsupported authorization: ${definition.name}`,
              retryable: false,
              cause: { owner: 'permissions', code: 'background_authorization_required' },
            },
          });
        }
        const result = await binding.executeToolInvocation({ invocation: routed.invocation }, {
          signal,
          onHandlerResult: (handlerResult) => safeRecordToolContent(
            trace?.observability,
            'tool.handler_result',
            handlerResult,
            correlation,
          ),
        });
        return recordToolResult(trace?.observability, correlation, completedToolOutcome({
          content: [{ type: 'text', text: result.normalizedResult.content }],
          isError: result.type === 'failed' || result.normalizedResult.isError,
        }));
      },
    ),
  };
}

async function executeRoutedTool(
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult) => void,
  dependencies: ToolAdapterDependencies,
  binding: ModelCallToolBinding,
): Promise<AgentToolExecutionOutcome<AgentToolResultDetails>> {
  if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
  let executionAccess: ToolExecutionAccess | undefined;
  if (operations.length > 0) {
    let permission;
    try {
      permission = await dependencies.permissions.evaluateToolCall({
        executionId: dependencies.metadata.executionId,
        sessionId: dependencies.metadata.sessionId,
        workspaceId: dependencies.metadata.workspaceId,
        toolCallId: invocation.toolCallId,
        toolInput: snapshotValue(invocation.input) as JsonValue,
        operations,
        permissionMode: dependencies.metadata.permissionMode,
        evaluatedAt: dependencies.clock.now(),
      });
    } catch {
      return systemToolFailure(
        dependencies,
        invocation.toolCallId,
        'Permission evaluation failed.',
        'permissions',
        'permission_evaluation_threw',
      );
    }
    if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
    if (permission.status === 'failed') {
      return systemToolFailure(
        dependencies,
        invocation.toolCallId,
        permission.failure.message,
        'permissions',
        permission.failure.code,
      );
    }
    if (permission.decision.type === 'deny') {
      safeRecordPermissionEvent(dependencies.observability, {
        type: 'tool.permission.resolved',
        toolCallId: invocation.toolCallId,
        decision: 'automatic_deny',
        reasonCode: permission.decision.denialCode,
      });
      return completedToolOutcome(settledToolResult({
        status: 'permission_denied',
        content: permission.decision.reason,
        completedAt: dependencies.clock.now(),
        error: { code: permission.decision.denialCode, message: permission.decision.reason },
      }));
    }
    if (permission.decision.type === 'requires_approval') {
      // The approval wait is part of this original ToolCall Promise; the Agent
      // Loop resumes only when the Discovery Agent settles the decision.
      const resolution = await requestApproval(invocation, permission.decision, signal, dependencies);
      if (resolution.status === 'cancelled' || signal.aborted) {
        return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
      }
      safeRecordPermissionEvent(dependencies.observability, {
        type: 'tool.permission.resolved',
        toolCallId: invocation.toolCallId,
        decision: resolution.status === 'approved' ? 'user_allow' : 'user_deny',
        ...(resolution.status === 'denied' ? { reasonCode: 'user_rejected' } : {}),
      });
      const applied = await applyApprovalDecision(
        invocation,
        operations,
        permission.decision,
        permission.approvalSubject,
        resolution.decision,
        dependencies,
      );
      if (applied.status === 'failed') {
        return systemToolFailure(
          dependencies,
          invocation.toolCallId,
          'Approval decision could not be applied.',
          'permissions',
          'approval_apply_failed',
        );
      }
      if (resolution.status === 'denied') {
        return completedToolOutcome(settledToolResult({
          status: 'user_rejected',
          content: 'Tool call was rejected by the user.',
          completedAt: dependencies.clock.now(),
          error: { code: 'user_rejected', message: 'Tool call was rejected by the user.' },
        }));
      }
      executionAccess = applied.executionAccess;
    } else {
      safeRecordPermissionEvent(dependencies.observability, {
        type: 'tool.permission.resolved',
        toolCallId: invocation.toolCallId,
        decision: 'automatic_allow',
      });
      if (!permission.executionAccess) {
        return systemToolFailure(
          dependencies,
          invocation.toolCallId,
          'Permission allow decision did not provide Tool execution access.',
          'permissions',
          'execution_access_missing',
        );
      }
      executionAccess = permission.executionAccess;
    }
  }
  return runToolInvocation(invocation, executionAccess, signal, onUpdate, dependencies, binding);
}

async function runToolInvocation(
  invocation: ToolInvocation,
  executionAccess: ToolExecutionAccess | undefined,
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult) => void,
  dependencies: ToolAdapterDependencies,
  binding: ModelCallToolBinding,
): Promise<AgentToolExecutionOutcome<AgentToolResultDetails>> {
  if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
  const toolExecutionId = dependencies.ids.createToolExecutionId();
  onUpdate({
    content: [],
    isError: false,
    details: {
      kind: 'execution_started',
      toolExecutionId,
      toolName: invocation.toolName,
      arguments: snapshotValue(invocation.input),
    } satisfies AgentToolUpdateDetails,
  });
  let accumulatedOutput = '';
  let closed: boolean = signal.aborted;
  signal.addEventListener('abort', () => { closed = true; }, { once: true });
  let execution;
  try {
    execution = await binding.executeToolInvocation({
      invocation,
      toolExecutionId,
    }, {
      signal,
      onOutput: (output) => {
        if (closed) return;
        accumulatedOutput += output.chunk;
        onUpdate({
          content: [{ type: 'text', text: accumulatedOutput }],
          isError: false,
          details: { kind: 'output', output: accumulatedOutput } satisfies AgentToolUpdateDetails,
        });
      },
      onNotification: (notification) => {
        if (closed) return;
        onUpdate({
          content: [],
          isError: false,
          details: { kind: 'plan_updated', notification } satisfies AgentToolUpdateDetails,
        });
      },
      onHandlerResult: (handlerResult) => safeRecordToolContent(
        dependencies.observability,
        'tool.handler_result',
        handlerResult,
        toolCorrelation(
          dependencies.metadata,
          invocation.modelCallId,
          invocation.toolCallId,
        ),
      ),
      ...(executionAccess ? { executionAccess } : {}),
    });
  } catch {
    execution = undefined;
  }
  closed = true;
  const completedAt = dependencies.clock.now();
  if (!execution) {
    return completedToolOutcome(signal.aborted
      ? cancelledToolResult(completedAt, toolExecutionId)
      : settledToolResult({
        status: 'failure',
        content: 'Tool execution failed.',
        completedAt,
        toolExecutionId,
        error: { code: 'tool_execution_failed', message: 'Tool execution failed.' },
      }));
  }
  if (execution.type === 'succeeded') {
    return completedToolOutcome(settledToolResult({
      status: 'success',
      content: execution.normalizedResult.content,
      completedAt,
      toolExecutionId,
      ...(execution.observation?.summary ? { summary: execution.observation.summary } : {}),
    }));
  }
  if (execution.error.code === 'tool_cancelled') {
    return completedToolOutcome(cancelledToolResult(completedAt, toolExecutionId));
  }
  return completedToolOutcome(settledToolResult({
    status: 'failure',
    content: execution.normalizedResult.content,
    completedAt,
    toolExecutionId,
    error: execution.error,
  }));
}

async function requestApproval(
  invocation: ToolInvocation,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  signal: AbortSignal,
  dependencies: ToolAdapterDependencies,
): Promise<ApprovalResolution> {
  if (signal.aborted) return { status: 'cancelled' };
  const approval = createApprovalRequest(invocation, decision, dependencies);
  emitApprovalRequested(approval, dependencies);
  const resolution = await observePermissionWait(
    dependencies.observability,
    toolCorrelation(
      dependencies.metadata,
      invocation.modelCallId,
      invocation.toolCallId,
    ),
    () => dependencies.awaitApproval({ approval }),
  );
  emitApprovalResolved(approval, resolution, dependencies);
  return resolution;
}

async function applyApprovalDecision(
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  originalDecision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  originalSubject: ApprovalSubject,
  decision: ApprovalDecision,
  dependencies: ToolAdapterDependencies,
): Promise<{ readonly status: 'applied'; readonly executionAccess?: ToolExecutionAccess } | { readonly status: 'failed' }> {
  try {
    const current = await dependencies.permissions.evaluateToolCall({
      executionId: dependencies.metadata.executionId,
      sessionId: dependencies.metadata.sessionId,
      workspaceId: dependencies.metadata.workspaceId,
      toolCallId: invocation.toolCallId,
      toolInput: snapshotValue(invocation.input) as JsonValue,
      operations,
      permissionMode: dependencies.metadata.permissionMode,
      evaluatedAt: dependencies.clock.now(),
    });
    if (current.status === 'failed') return { status: 'failed' };
    const applied = await dependencies.permissions.applyApprovalDecision({
      originalPermissionDecision: originalDecision,
      originalSubject,
      currentSubject: current.approvalSubject,
      decision,
      sessionId: dependencies.metadata.sessionId,
      appliedAt: dependencies.clock.now(),
      permissionMode: dependencies.metadata.permissionMode,
    });
    if (applied.status !== 'applied') return { status: 'failed' };
    return {
      status: 'applied',
      ...(applied.executionAccess ? { executionAccess: applied.executionAccess } : {}),
    };
  } catch {
    return { status: 'failed' };
  }
}

function createApprovalRequest(
  invocation: ToolInvocation,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  dependencies: ToolAdapterDependencies,
): ApprovalRequest {
  return {
    approvalId: dependencies.ids.createApprovalId(),
    executionId: dependencies.metadata.executionId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
    toolIdentity: snapshotToolIdentity(invocation.toolIdentity),
    input: snapshotValue(invocation.input),
    operations: decision.operations.map((operation) => snapshotValue(operation) as PermissionOperation),
    options: decision.options,
    defaultOptionId: decision.defaultOptionId,
    summary: `${invocation.toolName} requires approval.`,
    createdAt: dependencies.clock.now(),
    status: 'pending',
  };
}

function emitApprovalRequested(
  approval: ApprovalRequest,
  dependencies: ToolAdapterDependencies,
): void {
  emitRuntime(dependencies, 'approval.requested', {
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    toolIdentity: {
      sourceId: approval.toolIdentity.sourceId,
      namespace: approval.toolIdentity.namespace,
      sourceToolName: approval.toolIdentity.sourceToolName,
    },
    reason: approval.summary ?? `Approve ${approval.toolName}`,
    args: toRecord(approval.input),
    operations: approval.operations.map(toRecord),
    approvalRequestId: approval.approvalId,
    options: approval.options.map((option) => ({
      optionId: option.optionId,
      scope: option.scope,
      label: option.display.label,
      description: option.display.description,
    })),
    defaultOptionId: approval.defaultOptionId,
  });
}

function emitApprovalResolved(
  approval: ApprovalRequest,
  resolution: ApprovalResolution,
  dependencies: ToolAdapterDependencies,
): void {
  const decision = resolution.status;
  emitRuntime(dependencies, 'approval.resolved', {
    approvalRequestId: approval.approvalId,
    toolCallId: approval.toolCallId,
    decision,
    ...(decision === 'approved' && resolution.decision.decision === 'approved'
      ? { optionId: resolution.decision.optionId }
      : {}),
    decidedAt: dependencies.clock.now(),
  });
}

function emitRuntime<TType extends EventTypeOf>(
  dependencies: ToolAdapterDependencies,
  type: TType,
  payload: EventPayloadOf[TType],
): void {
  try {
    dependencies.events.publish({
      type,
      payload,
      sessionId: dependencies.metadata.sessionId,
      executionId: dependencies.metadata.executionId,
    });
  } catch {
    // Runtime Events are best-effort and never own the Tool outcome.
  }
}

type EventTypeOf = import('@megumi/events').EventType;
type EventPayloadOf = import('@megumi/events').EventPayloadByType;

function completedToolOutcome(result: AgentToolResult<AgentToolResultDetails>) {
  return { status: 'completed' as const, result };
}

function settledToolResult(
  input: Omit<AgentToolResultDetails, 'kind'>,
): AgentToolResult<AgentToolResultDetails> {
  const details: AgentToolResultDetails = { kind: 'settled', ...input };
  return {
    content: [{ type: 'text', text: input.content }],
    isError: input.status !== 'success',
    details,
  };
}

function cancelledToolResult(
  completedAt: string,
  toolExecutionId?: string,
): AgentToolResult<AgentToolResultDetails> {
  return settledToolResult({
    status: 'cancelled',
    content: 'Tool call was cancelled.',
    completedAt,
    error: { code: 'tool_cancelled', message: 'Tool call was cancelled.' },
    ...(toolExecutionId ? { toolExecutionId } : {}),
  });
}

function systemToolFailure(
  dependencies: ToolAdapterDependencies,
  toolCallId: string,
  message: string,
  owner: 'permissions' | 'tools',
  code: string,
) {
  const error: AgentError & { readonly code: 'tool_system_failed' } = {
    code: 'tool_system_failed',
    message,
    retryable: false,
    cause: { owner, code },
  };
  dependencies.toolSystemFailures.set(toolCallId, error);
  return {
    status: 'system_failed' as const,
    error,
  };
}

async function observeToolCall<TDetails>(
  observability: Observability | undefined,
  metadata: ExecutionMetadata | undefined,
  modelCallId: string,
  toolCallId: string,
  operation: () => Promise<AgentToolExecutionOutcome<TDetails>>,
): Promise<AgentToolExecutionOutcome<TDetails>> {
  let operationPromise: Promise<AgentToolExecutionOutcome<TDetails>> | undefined;
  const runOnce = (): Promise<AgentToolExecutionOutcome<TDetails>> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'tool.call',
      correlation: metadata
        ? toolCorrelation(metadata, modelCallId, toolCallId)
        : { modelCallId, toolCallId },
      classifyResult: classifyToolOutcome,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyToolOutcome<TDetails>(
  outcome: AgentToolExecutionOutcome<TDetails>,
): OperationCompletion {
  if (outcome.status === 'system_failed') {
    return {
      outcome: {
        status: 'error',
        code: outcome.error.code,
        message: outcome.error.message,
        retryable: outcome.error.retryable,
      },
    };
  }
  const status = diagnosticDetailStatus(outcome.result.details);
  if (status === 'cancelled') {
    return { outcome: { status: 'cancelled', code: 'tool_cancelled' } };
  }
  if (outcome.result.isError) {
    return {
      outcome: {
        status: 'error',
        code: status ?? 'tool_result_error',
        message: toolResultText(outcome.result) || 'Tool call failed.',
      },
    };
  }
  return { outcome: { status: 'ok', code: status ?? 'success' } };
}

function diagnosticDetailStatus(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'status');
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function toolResultText(result: AgentToolResult): string {
  return result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('');
}

async function observePermissionWait(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  operation: () => Promise<ApprovalResolution>,
): Promise<ApprovalResolution> {
  let operationPromise: Promise<ApprovalResolution> | undefined;
  const runOnce = (): Promise<ApprovalResolution> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'permission.await',
      correlation,
      classifyResult: (resolution) => resolution.status === 'cancelled'
        ? { outcome: { status: 'cancelled', code: 'approval_cancelled' } }
        : { outcome: { status: 'ok', code: resolution.status } },
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function recordToolResult<TDetails>(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  outcome: AgentToolExecutionOutcome<TDetails>,
): AgentToolExecutionOutcome<TDetails> {
  safeRecordToolContent(
    observability,
    'tool.result',
    outcome.status === 'completed' ? outcome.result : outcome,
    correlation,
  );
  return outcome;
}

function safeRecordToolContent(
  observability: Observability | undefined,
  kind: 'tool.request' | 'tool.arguments' | 'tool.handler_result' | 'tool.result',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Tool routing, Handler execution, and normalization remain authoritative.
  }
}

function safeRecordPermissionEvent(
  observability: Observability | undefined,
  event: Parameters<Observability['recordEvent']>[0],
): void {
  try {
    observability?.recordEvent(event);
  } catch {
    // Permission decisions never depend on diagnostic recording.
  }
}

function toolCorrelation(
  metadata: ExecutionMetadata,
  modelCallId: string,
  toolCallId: string,
): TraceCorrelation {
  return {
    requestId: metadata.requestId,
    executionId: metadata.executionId,
    modelCallId,
    toolCallId,
    ...(metadata.kind === 'conversation'
      ? {
          sessionId: metadata.sessionId,
          workspaceId: metadata.workspaceId,
        }
      : { batchId: metadata.batchId }),
  };
}

function snapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item)]));
  }
  return value;
}

function snapshotToolIdentity(identity: ToolIdentity): ToolIdentity {
  return { ...identity };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? snapshotValue(value) as Record<string, unknown>
    : {};
}
