/*
 * Orchestrates one model-call tool-call group.
 * It owns ordering, permission barriers, execution windows, and run-context facts.
 */
import type {
  PermissionDecision,
  PermissionMode,
  PermissionSettings,
  RegisteredToolFacts,
} from '../../permissions';
import {
  validateToolInput,
  type RegisteredTool,
  type ToolExecutionOptions,
  type ToolExecutionResult,
} from '../../tools';
import type { Tool } from '@megumi/ai';
import type { WorkspacePathPolicyService } from '../../workspace';
import type { AgentRunApprovalRequest, ToolCallStep } from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type { ToolResultRuntimeFact } from '../contracts/model-call-contracts';
import { mapToolExecutionResultToRuntimeFact } from './tool-result-mapper';

export type ModelRequestedToolCall = {
  model_call_id: string;
  tool_call_id: string;
  tool_name: string;
  input: unknown;
  arguments_text: string;
};

export type AgentRunToolCallRequest = {
  run_id: string;
  session_id: string;
  workspace_id: string;
  workspace_root?: string;
  permission_mode: PermissionMode;
  permission_settings: PermissionSettings;
  tools: Tool[];
  tool_calls: ModelRequestedToolCall[];
  call_order_offset?: number;
  registered_tools_by_name: Map<string, RegisteredTool>;
  permission_service: {
    evaluateToolCall(request: {
      run_id: string;
      session_id: string;
      workspace_id: string;
      tool_call_id: string;
      tool_input: unknown;
      registered_tool: RegisteredToolFacts;
      permission_mode: PermissionMode;
      permission_settings: PermissionSettings;
      workspace_path?: {
        absolute_path: string;
        workspace_path: string;
        inside_workspace: boolean;
        protected: boolean;
        sensitive: boolean;
      };
      evaluated_at: string;
    }): Promise<{ status: 'ok'; operations: unknown[]; decision: PermissionDecision } | { status: 'failed'; failure: { message: string } }>
      | { status: 'ok'; operations: unknown[]; decision: PermissionDecision } | { status: 'failed'; failure: { message: string } };
  };
  tool_execution_service: {
    executeTool(request: { toolName: string; input: unknown; options?: ToolExecutionOptions }): Promise<ToolExecutionResult> | ToolExecutionResult;
  };
  trace_logger?: AgentRunTraceLogger;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  clock: { now(): string };
  ids: {
    approval_request_id(): string;
  };
  signal?: AbortSignal;
  on_step_transition?: (step: ToolCallStep) => void;
};

export type AgentRunToolCallResult = {
  tool_calls: ToolCallStep[];
  tool_result_facts: ToolResultRuntimeFact[];
  pending_approvals: AgentRunPendingApproval[];
  deferred_tool_calls: ModelRequestedToolCall[];
  deferred_call_order_offset: number;
  next_model_call_ready: boolean;
};

export type AgentRunPendingApproval = {
  approval_request: AgentRunApprovalRequest;
  permission_decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
};

type ToolCallPlan = {
  call: ToolCallStep;
  requested: ModelRequestedToolCall;
  registered_tool?: RegisteredTool;
  decision?: PermissionDecision;
};

export async function orchestrateToolCallGroup(
  request: AgentRunToolCallRequest,
): Promise<AgentRunToolCallResult> {
  const plans: ToolCallPlan[] = [];
  const toolResults: ToolResultRuntimeFact[] = [];
  const pendingApprovals: AgentRunPendingApproval[] = [];
  let deferredToolCalls: ModelRequestedToolCall[] = [];
  let deferredCallOrderOffset = request.call_order_offset ?? 0;

  for (const [index, requested] of request.tool_calls.entries()) {
    const toolCall = createToolCall(request, requested, index);
    request.on_step_transition?.(toolCall);
    const registeredTool = resolveRegisteredTool(request, requested.tool_name);

    if (!registeredTool) {
      const failedCall = { ...toolCall, status: 'failed' as const, completed_at: request.clock.now() };
      request.on_step_transition?.(failedCall);
      plans.push({ call: failedCall, requested });
      toolResults.push(failedToolResult(requested, 'Unknown or unavailable tool.', request.clock.now()));
      request.trace_logger?.record({
        trace_id: request.run_id,
        event_type: 'trace.tool_execution.result',
        run_id: request.run_id,
        workspace_id: request.workspace_id,
        tool_call_id: requested.tool_call_id,
        payload: {
          tool_call_id: requested.tool_call_id,
          tool_name: requested.tool_name,
          result_type: 'failed',
          failure: {
            code: 'unknown_tool',
            message: 'Unknown or unavailable tool.',
          },
        },
      });
      continue;
    }

    const inputValidation = validateToolInput(registeredTool.definition, requested.input);
    if (!inputValidation.ok) {
      const failedCall = { ...toolCall, status: 'failed' as const, completed_at: request.clock.now() };
      request.on_step_transition?.(failedCall);
      plans.push({ call: failedCall, requested, registered_tool: registeredTool });
      toolResults.push(failedToolResult(
        requested,
        inputValidation.errorMessage,
        request.clock.now(),
        'invalid_tool_input',
      ));
      continue;
    }

    const permission = await request.permission_service.evaluateToolCall({
      run_id: request.run_id,
      session_id: request.session_id,
      workspace_id: request.workspace_id,
      tool_call_id: requested.tool_call_id,
      tool_input: requested.input,
      registered_tool: permissionFactsFromRegisteredTool(registeredTool),
      permission_mode: request.permission_mode,
      permission_settings: request.permission_settings,
      ...(workspacePathFacts(request, requested.input) ? { workspace_path: workspacePathFacts(request, requested.input) } : {}),
      evaluated_at: request.clock.now(),
    });

    if (permission.status === 'failed') {
      const failedCall = { ...toolCall, status: 'failed' as const, completed_at: request.clock.now() };
      request.on_step_transition?.(failedCall);
      plans.push({ call: failedCall, requested, registered_tool: registeredTool });
      toolResults.push(failedToolResult(requested, permission.failure.message, request.clock.now()));
      continue;
    }

    request.trace_logger?.record({
      trace_id: request.run_id,
      event_type: 'trace.tool_call.executable',
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      tool_call_id: requested.tool_call_id,
      payload: {
        tool_call_id: requested.tool_call_id,
        tool_name: requested.tool_name,
        registered_tool_name: registeredTool.registeredToolName,
        permission_decision: permission.decision,
        input: requested.input,
      },
    });

    if (permission.decision.type === 'deny') {
      const deniedCall = { ...toolCall, status: 'denied' as const, completed_at: request.clock.now() };
      request.on_step_transition?.(deniedCall);
      plans.push({
        call: deniedCall,
        requested,
        registered_tool: registeredTool,
        decision: permission.decision,
      });
      toolResults.push(deniedToolResult(requested, permission.decision.reason, request.clock.now()));
      request.trace_logger?.record({
        trace_id: request.run_id,
        event_type: 'trace.tool_execution.result',
        run_id: request.run_id,
        workspace_id: request.workspace_id,
        tool_call_id: requested.tool_call_id,
        payload: {
          tool_call_id: requested.tool_call_id,
          tool_name: registeredTool.registeredToolName,
          result_type: 'denied',
          failure: {
            code: 'permission_denied',
            message: permission.decision.reason,
          },
        },
      });
      continue;
    }

    if (permission.decision.type === 'requires_approval') {
      const approval = createPendingApproval(request, requested, registeredTool, permission.decision);
      const waitingCall = {
        ...toolCall,
        status: 'waiting_for_approval' as const,
        approval_request_id: approval.approval_request_id,
      };
      request.on_step_transition?.(waitingCall);
      plans.push({
        call: waitingCall,
        requested,
        registered_tool: registeredTool,
        decision: permission.decision,
      });
      pendingApprovals.push({
        approval_request: approval,
        permission_decision: permission.decision,
      });
      deferredToolCalls = request.tool_calls.slice(index + 1);
      deferredCallOrderOffset = (request.call_order_offset ?? 0) + index + 1;
      break;
    }

    plans.push({
      call: { ...toolCall, status: 'requested' },
      requested,
      registered_tool: registeredTool,
      decision: permission.decision,
    });
  }

  const executablePlans = plans.filter((plan) => (
    plan.call.status === 'requested'
    && plan.registered_tool
  ));
  if (executablePlans.length > 0) {
    const executed = await executeWindows(request, executablePlans);
    for (const plan of executed.plans) {
      plans[plans.indexOf(plan.original)] = plan.next;
    }
    toolResults.push(...executed.tool_result_facts);
  }
  const callOrderById = new Map(plans.map((plan) => [plan.call.tool_call_id, plan.call.call_order]));
  toolResults.sort((left, right) => (
    (callOrderById.get(left.tool_call_id) ?? Number.MAX_SAFE_INTEGER)
      - (callOrderById.get(right.tool_call_id) ?? Number.MAX_SAFE_INTEGER)
  ));

  return {
    tool_calls: plans.map((plan) => plan.call),
    tool_result_facts: toolResults,
    pending_approvals: pendingApprovals,
    deferred_tool_calls: deferredToolCalls,
    deferred_call_order_offset: deferredCallOrderOffset,
    next_model_call_ready: pendingApprovals.length === 0,
  };
}

async function executeWindows(
  request: AgentRunToolCallRequest,
  executablePlans: ToolCallPlan[],
): Promise<{
  plans: Array<{ original: ToolCallPlan; next: ToolCallPlan }>;
  tool_result_facts: ToolResultRuntimeFact[];
}> {
  const updates: Array<{ original: ToolCallPlan; next: ToolCallPlan }> = [];
  const toolResults: ToolResultRuntimeFact[] = [];
  let index = 0;

  while (index < executablePlans.length) {
    const current = executablePlans[index];
    if (!current?.registered_tool) break;
    const mode = current.registered_tool.definition.executionMode ?? 'serial';
    const window = mode === 'parallel'
      ? takeParallelWindow(executablePlans, index)
      : [current];

    const executions = await Promise.all(window.map(async (plan) => {
      request.on_step_transition?.({ ...plan.call, status: 'executing' });
      request.trace_logger?.record({
        trace_id: request.run_id,
        event_type: 'trace.tool_execution.request',
        run_id: request.run_id,
        workspace_id: request.workspace_id,
        tool_call_id: plan.requested.tool_call_id,
        payload: {
          tool_call_id: plan.requested.tool_call_id,
          tool_name: plan.registered_tool!.registeredToolName,
          input: plan.requested.input,
          execution_mode: plan.registered_tool!.definition.executionMode ?? 'serial',
        },
      });
      const result = await request.tool_execution_service.executeTool({
        toolName: plan.registered_tool!.registeredToolName,
        input: plan.requested.input,
        ...(request.signal ? { options: { signal: request.signal } } : {}),
      });
      request.trace_logger?.record({
        trace_id: request.run_id,
        event_type: 'trace.tool_execution.result',
        run_id: request.run_id,
        workspace_id: request.workspace_id,
        tool_call_id: plan.requested.tool_call_id,
        payload: {
          tool_call_id: plan.requested.tool_call_id,
          tool_name: result.toolName ?? plan.registered_tool!.registeredToolName,
          result_type: result.type,
          normalized_result: result.normalizedResult,
          ...(result.toolExecutionObservation ? { tool_execution_observation: result.toolExecutionObservation } : {}),
          ...(result.type === 'failed' ? { failure: result.error } : {}),
        },
      });
      const completedAt = request.clock.now();
      const status: ToolCallStep['status'] = result.type === 'succeeded' ? 'completed' : 'failed';
      const completedCall: ToolCallStep = {
        ...plan.call,
        status,
        completed_at: completedAt,
        ...(result.type === 'failed' ? {
          failure: { code: 'tool_call_failed', message: result.error.message },
        } : {}),
      };
      request.on_step_transition?.(completedCall);
      return {
        original: plan,
        next: {
          ...plan,
          call: completedCall,
        },
        tool_result: mapToolExecutionResultToRuntimeFact({
          tool_call_id: plan.requested.tool_call_id,
          tool_name: plan.requested.tool_name,
          result,
          created_at: completedAt,
        }),
      };
    }));

    for (const execution of executions) {
      updates.push({ original: execution.original, next: execution.next });
      toolResults.push(execution.tool_result);
    }

    index += window.length;
  }

  return { plans: updates, tool_result_facts: toolResults };
}

function takeParallelWindow(plans: ToolCallPlan[], start: number): ToolCallPlan[] {
  const window: ToolCallPlan[] = [];
  for (let index = start; index < plans.length; index += 1) {
    const plan = plans[index];
    if (!plan?.registered_tool || (plan.registered_tool.definition.executionMode ?? 'serial') !== 'parallel') {
      break;
    }
    window.push(plan);
  }
  return window;
}

function createToolCall(
  request: AgentRunToolCallRequest,
  toolCall: ModelRequestedToolCall,
  callOrder: number,
): ToolCallStep {
  return {
    type: 'tool_call',
    tool_call_id: toolCall.tool_call_id,
    run_id: request.run_id,
    source_model_call_id: toolCall.model_call_id,
    call_order: (request.call_order_offset ?? 0) + callOrder,
    tool_name: toolCall.tool_name,
    input: toolCall.input,
    arguments_text: toolCall.arguments_text,
    status: 'requested',
    created_at: request.clock.now(),
  };
}

function resolveRegisteredTool(
  request: AgentRunToolCallRequest,
  toolName: string,
): RegisteredTool | undefined {
  if (!request.tools.some((item) => item.name === toolName)) {
    return undefined;
  }
  return request.registered_tools_by_name.get(toolName);
}

function createPendingApproval(
  request: AgentRunToolCallRequest,
  toolCall: ModelRequestedToolCall,
  registeredTool: RegisteredTool,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
): AgentRunApprovalRequest {
  const preview = approvalPreview(registeredTool.registeredToolName, toolCall.input);
  return {
    approval_request_id: request.ids.approval_request_id(),
    run_id: request.run_id,
    subject: {
      type: 'tool_call',
      tool_call_id: toolCall.tool_call_id,
      tool_name: registeredTool.registeredToolName,
      input: toolCall.input,
      tool_identity: {
        source_id: registeredTool.identity.sourceId,
        namespace: registeredTool.identity.namespace,
        source_tool_name: registeredTool.identity.sourceToolName,
      },
    },
    status: 'pending',
    options: decision.options,
    default_option_id: decision.default_option_id,
    summary: `${registeredTool.registeredToolName} requires approval.`,
    preview,
    operations: decision.operations,
    created_at: request.clock.now(),
  };
}

function approvalPreview(toolName: string, input: unknown): AgentRunApprovalRequest['preview'] {
  const target = approvalTarget(input);
  return {
    action: target ? `${toolName} ${target.label}` : toolName,
    targets: target ? [target] : [],
  };
}

function approvalTarget(input: unknown): { kind: string; label: string } | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const values = input as Record<string, unknown>;
  if (typeof values.path === 'string' && values.path.length > 0) {
    return { kind: 'file', label: values.path };
  }
  if (typeof values.command === 'string' && values.command.length > 0) {
    return { kind: 'command', label: values.command };
  }
  return undefined;
}

function failedToolResult(
  toolCall: ModelRequestedToolCall,
  message: string,
  createdAt: string,
  code = 'tool_execution_failed',
): ToolResultRuntimeFact {
  return {
    tool_call_id: toolCall.tool_call_id,
    tool_name: toolCall.tool_name,
    status: 'failure',
    error: { code, message },
    content: message,
    created_at: createdAt,
  };
}

function deniedToolResult(
  toolCall: ModelRequestedToolCall,
  reason: string,
  createdAt: string,
): ToolResultRuntimeFact {
  return {
    tool_call_id: toolCall.tool_call_id,
    tool_name: toolCall.tool_name,
    status: 'permission_denied',
    error: { code: 'permission_denied', message: reason },
    content: reason,
    created_at: createdAt,
  };
}

function workspacePathFacts(
  request: AgentRunToolCallRequest,
  input: unknown,
): ReturnType<NonNullable<AgentRunToolCallRequest['workspace_path_policy_service']>['classifyPath']> | undefined {
  if (!request.workspace_path_policy_service || !request.workspace_root) {
    return undefined;
  }
  const targetPath = extractTargetPath(input);
  if (!targetPath) {
    return undefined;
  }
  return request.workspace_path_policy_service.classifyPath({
    workspace_root: request.workspace_root,
    target_path: targetPath,
  });
}

function extractTargetPath(input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null && 'path' in input && typeof input.path === 'string') {
    return input.path;
  }
  return undefined;
}

function permissionFactsFromRegisteredTool(tool: RegisteredTool): RegisteredToolFacts {
  return {
    registered_tool_name: tool.registeredToolName,
    source_id: tool.identity.sourceId,
    namespace: tool.identity.namespace,
    source_tool_name: tool.identity.sourceToolName,
  };
}
