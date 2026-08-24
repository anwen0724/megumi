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
} from './execution-registry';
import type { ExecutionObserver } from './execution-observer';
import type { SessionToolResultCommit } from './session-settlement';
import type { ToolScope } from './context-adapter';

export type DiscoveryAgentToolUpdateDetails =
  | {
      readonly kind: 'execution_started';
      readonly toolExecutionId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | { readonly kind: 'output'; readonly output: string }
  | { readonly kind: 'plan_updated'; readonly notification: ToolExecutionNotification };

export interface DiscoveryAgentToolResultDetails {
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
  readonly observer: ExecutionObserver;
  /** The Discovery Agent's approval wait seam; the original ToolCall Promise awaits it in place. */
  readonly awaitApproval: (request: { readonly approval: ApprovalRequest }) => Promise<ApprovalResolution>;
  readonly toolSystemFailures: Map<string, AgentError>;
}

export function createAgentTool(
  dependencies: ToolAdapterDependencies,
): (definition: ToolDefinition, scope: ToolScope) => AgentTool<DiscoveryAgentToolResultDetails> {
  return (definition, scope) => ({
    // Preserve Context-facing Tool guidance metadata on the runtime object;
    // Agent Core and provider adapters consume only the AgentTool contract.
    ...definition,
    parameters: definition.parameters as AgentTool['parameters'],
    executionMode: definition.executionMode === 'serial' ? 'sequential' : 'parallel',
    execute: async ({ toolCallId, arguments: argumentsValue, signal, onUpdate }) => {
      const routed = scope.binding.routeToolCall({
        toolCallId,
        toolName: definition.name,
        input: argumentsValue,
      });
      if (routed.status === 'failed') {
        return completedToolOutcome(settledToolResult({
          status: 'failure',
          content: routed.error.message,
          completedAt: dependencies.clock.now(),
          error: routed.error,
        }));
      }
      // The internal flow publishes update details of several kinds; the
      // execute() result itself always carries the settled details type.
      return executeRoutedTool(
        routed.invocation,
        routed.operations,
        signal,
        onUpdate as (update: AgentToolResult) => void,
        dependencies,
        scope.binding,
      );
    },
  });
}

/**
 * Adapts an operations-free Tool binding to Agent Core. Background Agents use
 * the same Router and executor as Session executions, but have no Approval UI.
 */
export function createUnprotectedAgentTool(
  definition: ToolDefinition,
  binding: ModelCallToolBinding,
): AgentTool {
  return {
    ...definition,
    parameters: definition.parameters as AgentTool['parameters'],
    executionMode: definition.executionMode === 'serial' ? 'sequential' : 'parallel',
    async execute({ toolCallId, arguments: input, signal }) {
      const routed = binding.routeToolCall({ toolCallId, toolName: definition.name, input });
      if (routed.status === 'failed') {
        return completedToolOutcome({
          content: [{ type: 'text', text: routed.error.message }],
          isError: true,
        });
      }
      if (routed.operations.length > 0) {
        return {
          status: 'system_failed',
          error: {
            code: 'tool_system_failed',
            message: `Background Tool requires unsupported authorization: ${definition.name}`,
            retryable: false,
            cause: { owner: 'permissions', code: 'background_authorization_required' },
          },
        };
      }
      const result = await binding.executeToolInvocation({ invocation: routed.invocation }, { signal });
      return completedToolOutcome({
        content: [{ type: 'text', text: result.normalizedResult.content }],
        isError: result.type === 'failed' || result.normalizedResult.isError,
      });
    },
  };
}

async function executeRoutedTool(
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult) => void,
  dependencies: ToolAdapterDependencies,
  binding: ModelCallToolBinding,
): Promise<AgentToolExecutionOutcome<DiscoveryAgentToolResultDetails>> {
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
): Promise<AgentToolExecutionOutcome<DiscoveryAgentToolResultDetails>> {
  if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
  const toolExecutionId = dependencies.ids.createToolExecutionId();
  const span = dependencies.observer.startSpan('tool.call', {
    modelCallId: invocation.modelCallId,
    toolCallId: invocation.toolCallId,
  });
  onUpdate({
    content: [],
    isError: false,
    details: {
      kind: 'execution_started',
      toolExecutionId,
      toolName: invocation.toolName,
      arguments: snapshotValue(invocation.input),
    } satisfies DiscoveryAgentToolUpdateDetails,
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
          details: { kind: 'output', output: accumulatedOutput } satisfies DiscoveryAgentToolUpdateDetails,
        });
      },
      onNotification: (notification) => {
        if (closed) return;
        onUpdate({
          content: [],
          isError: false,
          details: { kind: 'plan_updated', notification } satisfies DiscoveryAgentToolUpdateDetails,
        });
      },
      ...(executionAccess ? { executionAccess } : {}),
    });
  } catch {
    execution = undefined;
  }
  closed = true;
  const completedAt = dependencies.clock.now();
  if (!execution) {
    dependencies.observer.endSpan(span, signal.aborted ? 'cancelled' : 'error');
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
    dependencies.observer.endSpan(span, 'ok');
    return completedToolOutcome(settledToolResult({
      status: 'success',
      content: execution.normalizedResult.content,
      completedAt,
      toolExecutionId,
      ...(execution.observation?.summary ? { summary: execution.observation.summary } : {}),
    }));
  }
  if (execution.error.code === 'tool_cancelled') {
    dependencies.observer.endSpan(span, 'cancelled');
    return completedToolOutcome(cancelledToolResult(completedAt, toolExecutionId));
  }
  dependencies.observer.endSpan(span, 'error');
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
  const wait = dependencies.awaitApproval({ approval });
  emitApprovalRequested(approval, dependencies);
  const span = dependencies.observer.startSpan('approval.wait', {
    approvalId: approval.approvalId,
    toolCallId: approval.toolCallId,
  });
  const resolution = await wait;
  dependencies.observer.endSpan(span, resolution.status === 'cancelled' ? 'cancelled' : 'ok');
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

function completedToolOutcome(result: AgentToolResult<DiscoveryAgentToolResultDetails>) {
  return { status: 'completed' as const, result };
}

function settledToolResult(
  input: Omit<DiscoveryAgentToolResultDetails, 'kind'>,
): AgentToolResult<DiscoveryAgentToolResultDetails> {
  const details: DiscoveryAgentToolResultDetails = { kind: 'settled', ...input };
  return {
    content: [{ type: 'text', text: input.content }],
    isError: input.status !== 'success',
    details,
  };
}

function cancelledToolResult(
  completedAt: string,
  toolExecutionId?: string,
): AgentToolResult<DiscoveryAgentToolResultDetails> {
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
