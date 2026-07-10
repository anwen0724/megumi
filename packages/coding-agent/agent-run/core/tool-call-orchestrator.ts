/*
 * Orchestrates one model-call tool-call group.
 * It owns ordering, permission barriers, execution windows, and run-context facts.
 */
import type {
  PermissionDecision,
  PermissionMode,
  PermissionSettings,
  RegisteredToolPermissionFacts,
  ToolCapability,
  ToolSideEffect,
} from '../../permissions';
import type { RegisteredTool, ToolExecutionResult } from '../../tools';
import type { SessionContextSource } from '../../context';
import type { WorkspacePathPolicyService } from '../../workspace';
import type { AgentRunApprovalRequest, AgentRunToolCall } from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type { ToolResultRuntimeFact, ToolSet } from '../contracts/model-call-contracts';

export type ModelRequestedToolCall = {
  model_call_id?: string;
  tool_call_id: string;
  tool_name: string;
  input: unknown;
  arguments_text: string;
};

export type AgentRunToolCallRequest = {
  run_id: string;
  workspace_id: string;
  workspace_root?: string;
  permission_mode: PermissionMode;
  permission_settings: PermissionSettings;
  runtime_capability_policy: {
    custom_tools_enabled: boolean;
    process_execution_enabled: boolean;
    network_enabled: boolean;
  };
  tool_set: ToolSet;
  tool_calls: ModelRequestedToolCall[];
  registered_tools_by_name: Map<string, RegisteredTool>;
  permission_service: {
    evaluateToolExecution(request: {
      run_id: string;
      tool_call_id: string;
      tool_name: string;
      tool_input: unknown;
      registered_tool?: {
        registered_tool_name: string;
        source_id: string;
        source_tool_name: string;
        capabilities: Array<'project_read' | 'project_write' | 'command_run' | 'network_access' | 'browser_access' | 'custom'>;
        risk_level: 'low' | 'medium' | 'high' | 'critical';
        side_effect: 'none' | 'project_file_operation' | 'process_execution' | 'network' | 'external';
        permission_metadata?: Record<string, unknown>;
      };
      permission_mode: PermissionMode;
      permission_settings?: PermissionSettings;
      runtime_capability_policy: {
        custom_tools_enabled: boolean;
        process_execution_enabled: boolean;
        network_enabled: boolean;
      };
      workspace_path?: {
        inside_workspace: boolean;
        protected: boolean;
        sensitive: boolean;
        workspace_path?: string;
      };
      evaluated_at: string;
    }): { status: 'ok'; decision: PermissionDecision } | { status: 'failed'; failure: { message: string } };
  };
  tool_execution_service: {
    executeTool(request: { toolName: string; input: unknown; options?: { signal?: AbortSignal } }): Promise<ToolExecutionResult> | ToolExecutionResult;
  };
  trace_logger?: AgentRunTraceLogger;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  clock: { now(): string };
  ids: {
    approval_request_id(): string;
  };
  signal?: AbortSignal;
};

export type AgentRunToolCallResult = {
  tool_calls: AgentRunToolCall[];
  tool_result_facts: ToolResultRuntimeFact[];
  pending_approvals: AgentRunPendingApproval[];
  deferred_tool_calls: ModelRequestedToolCall[];
  next_model_prompt_ready: boolean;
};

export type AgentRunPendingApproval = {
  approval_request: AgentRunApprovalRequest;
  permission_decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
};

type ToolCallPlan = {
  call: AgentRunToolCall;
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

  for (const [index, requested] of request.tool_calls.entries()) {
    const toolCall = createToolCall(request, requested, index);
    const registeredTool = resolveRegisteredTool(request, requested.tool_name);

    if (!registeredTool) {
      plans.push({ call: { ...toolCall, status: 'failed', completed_at: request.clock.now() }, requested });
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

    const permission = request.permission_service.evaluateToolExecution({
      run_id: request.run_id,
      tool_call_id: requested.tool_call_id,
      tool_name: registeredTool.registeredToolName,
      tool_input: requested.input,
      registered_tool: permissionFactsFromRegisteredTool(registeredTool),
      permission_mode: request.permission_mode,
      permission_settings: request.permission_settings,
      runtime_capability_policy: request.runtime_capability_policy,
      ...(workspacePathFacts(request, requested.input) ? { workspace_path: workspacePathFacts(request, requested.input) } : {}),
      evaluated_at: request.clock.now(),
    });

    if (permission.status === 'failed') {
      plans.push({ call: { ...toolCall, status: 'failed', completed_at: request.clock.now() }, requested, registered_tool: registeredTool });
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
      plans.push({
        call: { ...toolCall, status: 'denied', completed_at: request.clock.now() },
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
      plans.push({
        call: {
          ...toolCall,
          status: 'waiting_for_approval',
          approval_request_id: approval.approval_request_id,
        },
        requested,
        registered_tool: registeredTool,
        decision: permission.decision,
      });
      pendingApprovals.push({
        approval_request: approval,
        permission_decision: permission.decision,
      });
      continue;
    }

    plans.push({
      call: { ...toolCall, status: 'requested' },
      requested,
      registered_tool: registeredTool,
      decision: permission.decision,
    });
  }

  const firstApprovalOrder = plans.find((plan) => plan.call.status === 'waiting_for_approval')?.call.call_order;
  const executablePlans = plans.filter((plan) => (
    plan.call.status === 'requested'
    && plan.registered_tool
    && (firstApprovalOrder === undefined || plan.call.call_order < firstApprovalOrder)
  ));
  if (executablePlans.length > 0) {
    const executed = await executeWindows(request, executablePlans);
    for (const plan of executed.plans) {
      plans[plans.indexOf(plan.original)] = plan.next;
    }
    toolResults.push(...executed.tool_result_facts);
  }
  const lastApprovalOrder = plans
    .filter((plan) => plan.call.status === 'waiting_for_approval')
    .at(-1)?.call.call_order;
  const deferredToolCalls = lastApprovalOrder === undefined
    ? []
    : request.tool_calls.slice(lastApprovalOrder + 1);

  return {
    tool_calls: plans.map((plan) => plan.call),
    tool_result_facts: toolResults,
    pending_approvals: pendingApprovals,
    deferred_tool_calls: deferredToolCalls,
    next_model_prompt_ready: pendingApprovals.length === 0,
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
      const status: AgentRunToolCall['status'] = result.type === 'succeeded' ? 'completed' : 'failed';
      return {
        original: plan,
        next: {
          ...plan,
          call: {
            ...plan.call,
            status,
            completed_at: completedAt,
            ...(result.type === 'failed' ? {
              failure: {
                code: 'tool_call_failed' as const,
                message: result.error.message,
              },
            } : {}),
          },
        },
        tool_result: toolResultFromExecutionResult(plan.requested, result, completedAt),
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
): AgentRunToolCall {
  return {
    tool_call_id: toolCall.tool_call_id,
    run_id: request.run_id,
    call_order: callOrder,
    tool_name: toolCall.tool_name,
    input: toolCall.input,
    status: 'requested',
    created_at: request.clock.now(),
  };
}

function resolveRegisteredTool(
  request: AgentRunToolCallRequest,
  toolName: string,
): RegisteredTool | undefined {
  if (!request.tool_set.items.some((item) => item.name === toolName)) {
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
    },
    status: 'pending',
    requested_scope: decision.approval.default_scope,
    summary: `${registeredTool.registeredToolName} requires approval.`,
    preview,
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
): ToolResultRuntimeFact {
  return {
    tool_call_id: toolCall.tool_call_id,
    tool_name: toolCall.tool_name,
    status: 'failed',
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
    status: 'denied',
    content: reason,
    created_at: createdAt,
  };
}

function toolResultFromExecutionResult(
  toolCall: ModelRequestedToolCall,
  result: ToolExecutionResult,
  createdAt: string,
): ToolResultRuntimeFact {
  return {
    tool_call_id: toolCall.tool_call_id,
    tool_name: result.toolName ?? toolCall.tool_name,
    status: result.type === 'succeeded' ? 'completed' : 'failed',
    content: result.normalizedResult.content,
    ...(result.toolExecutionObservation ? { observation: result.toolExecutionObservation } : {}),
    ...(result.type === 'succeeded' && result.runtimeSources?.length
      ? { runtime_sources: result.runtimeSources.map(toSessionContextSource) }
      : {}),
    created_at: createdAt,
  };
}

function toSessionContextSource(source: NonNullable<Extract<ToolExecutionResult, { type: 'succeeded' }>['runtimeSources']>[number]): SessionContextSource {
  return {
    source_id: source.source_id,
    source_kind: source.source_kind as SessionContextSource['source_kind'],
    text: source.text,
    persisted: source.persisted,
    ...(source.metadata ? { metadata: source.metadata } : {}),
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

function permissionFactsFromRegisteredTool(tool: RegisteredTool): RegisteredToolPermissionFacts {
  return {
    registered_tool_name: tool.registeredToolName,
    source_id: tool.identity.sourceId,
    source_tool_name: tool.identity.sourceToolName,
    capabilities: tool.definition.capabilities.map(mapCapability),
    risk_level: tool.definition.riskLevel,
    side_effect: mapSideEffect(tool.definition.sideEffect),
    ...(tool.definition.permissionMetadata ? { permission_metadata: tool.definition.permissionMetadata } : {}),
  };
}

function mapCapability(capability: RegisteredTool['definition']['capabilities'][number]): ToolCapability {
  if (capability === 'mcp_tool' || capability === 'secret_read' || capability === 'system_integration' || capability === 'external_app') {
    return 'custom';
  }
  return capability;
}

function mapSideEffect(sideEffect: RegisteredTool['definition']['sideEffect']): ToolSideEffect {
  switch (sideEffect) {
    case 'read_external':
      return 'external';
    case 'execute_command':
      return 'process_execution';
    case 'access_network':
      return 'network';
    case 'project_file_operation':
      return 'project_file_operation';
    case 'access_secret':
    case 'modify_external':
    case 'system_change':
      return 'external';
    case 'none':
    default:
      return 'none';
  }
}
