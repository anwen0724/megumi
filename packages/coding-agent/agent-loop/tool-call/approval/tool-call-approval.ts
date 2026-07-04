// Applies Permission Service decisions to tool executions created by model tool calls.
import type {
  PermissionDecision,
  ToolCapability,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolRiskLevel,
  ToolSideEffect,
} from '@megumi/shared/tool';
import type { ToolDefinition } from '../../../tools';
import type {
  EvaluateToolExecutionRequest,
  PermissionDecision as ServicePermissionDecision,
  PermissionDenialCode,
  PermissionExecutionClass,
  RegisteredToolPermissionFacts,
  ToolCapability as PermissionToolCapability,
  ToolSideEffect as PermissionToolSideEffect,
} from '../../../permissions';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';
import { createApprovalRequest } from './approval-events';
import { createRejectionObservation } from './rejection-observation';

export async function applyDecisionsToCreated(
  options: ResolvedToolCallRunnerOptions,
  input: { runId: string; assistantMessageId: string },
): Promise<void> {
  const records = options.repository.listToolExecutionsByAssistantMessage(input);
  for (const record of records) {
    if (record.status !== 'created' || record.decision) {
      continue;
    }
    applyDecision(options, record);
  }
}

export function inferredDefinitionFields(
  toolName: string,
): Pick<ToolDefinition, 'capabilities' | 'riskLevel' | 'sideEffect'> {
  if (toolName === 'run_command') {
    return {
      capabilities: ['command_run'],
      riskLevel: 'medium',
      sideEffect: 'execute_command',
    };
  }
  if (toolName === 'edit_file' || toolName === 'write_file') {
    return {
      capabilities: ['project_write'],
      riskLevel: 'medium',
      sideEffect: 'project_file_operation',
    };
  }
  return {
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
  };
}

function applyDecision(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
): ToolExecutionRecord {
  const evaluated = options.permissionService.evaluateToolExecution(evaluateRequestForRecord(options, record));
  if (evaluated instanceof Promise) {
    throw new Error('PermissionService.evaluateToolExecution must be synchronous inside tool-call preparation.');
  }

  const serviceDecision = evaluated.status === 'ok'
    ? evaluated.decision
    : serviceFailureDecision(evaluated.failure.message);
  const permissionDecision = options.repository.recordPermissionDecision(
    permissionDecisionForRecord(options, record, serviceDecision),
  );
  const decision = toolExecutionDecisionFromPermissionDecision(serviceDecision);

  if (decision.outcome === 'reject') {
    const observation = createRejectionObservation({
      record,
      decision,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.recordToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      status: 'rejected',
      completedAt: observation.createdAt,
      observation,
      resultPreview: observation.content.slice(0, 500),
    });
  }

  if (decision.outcome === 'requireApproval') {
    const approvalRequest = options.repository.createApprovalRequest(createApprovalRequest(options, record, decision));
    return options.repository.recordToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'awaitingApproval',
    });
  }

  return options.repository.recordToolExecution({
    ...record,
    decision,
    policyDecision: permissionDecision,
    executionMode: decision.executionMode,
    status: 'queued',
  });
}

function evaluateRequestForRecord(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
): EvaluateToolExecutionRequest {
  return {
    run_id: String(record.runId),
    tool_call_id: String(record.toolCallId),
    tool_name: String(record.toolName),
    tool_input: record.input,
    registered_tool: registeredToolFactsFromRecord(record),
    permission_mode: options.permissionMode,
    permission_settings: options.permissionSettings,
    workspace_path: workspacePathFactsFromRecord(options, record),
    runtime_capability_policy: options.runtimeCapabilityPolicy,
    evaluated_at: options.now(),
  };
}

function permissionDecisionForRecord(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
  decision: ServicePermissionDecision,
): PermissionDecision {
  const definition = definitionForRecord(record);
  return {
    permissionDecisionId: options.ids.permissionDecisionId(),
    toolCallId: record.toolCallId,
    toolExecutionId: record.toolExecutionId,
    runId: record.runId,
    ...(record.modelVisibleName ? { modelVisibleName: record.modelVisibleName } : {}),
    ...(record.canonicalToolId ? { canonicalToolId: record.canonicalToolId } : {}),
    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
    ...(record.namespace ? { namespace: record.namespace } : {}),
    ...(record.sourceToolName ? { sourceToolName: record.sourceToolName } : {}),
    decision: legacyPolicyDecisionValue(decision),
    source: legacyPermissionDecisionSource(decision),
    reason: decision.reason,
    mode: options.permissionMode,
    capability: definition.capabilities[0],
    sideEffect: definition.sideEffect,
    effectiveRiskLevel: decision.type === 'deny' ? escalateRisk(definition.riskLevel, 'high') : definition.riskLevel,
    ...(decision.type === 'requires_approval' ? {
      requiredApproval: {
        scope: 'once',
        reason: decision.reason,
      },
    } : {}),
    requiredSandbox: {
      level: legacySandboxLevel(decision.execution_class),
      allowedRoots: [options.projectRoot],
      networkPolicy: 'deny',
    },
    evaluatedAt: options.now(),
  };
}

function definitionForRecord(
  record: ToolExecutionRecord,
): ToolDefinition {
  const inferred = inferredDefinitionFields(record.toolName);
  return {
    name: record.toolName,
    description: record.toolName,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    capabilities: [...(record.capabilities ?? inferred.capabilities)],
    riskLevel: record.riskLevel ?? inferred.riskLevel,
    sideEffect: record.sideEffect ?? inferred.sideEffect,
    availability: { status: 'available' },
    executionMode: record.executionMode,
  };
}

function registeredToolFactsFromRecord(record: ToolExecutionRecord): RegisteredToolPermissionFacts | undefined {
  if (!record.sourceId || !record.namespace || !record.sourceToolName || !record.modelVisibleName) {
    return undefined;
  }
  return {
    registered_tool_name: record.modelVisibleName,
    source_id: record.sourceId,
    source_tool_name: record.sourceToolName,
    capabilities: (record.capabilities ?? []).map(toPermissionCapability),
    risk_level: record.riskLevel ?? 'medium',
    side_effect: toPermissionSideEffect(record.sideEffect),
  };
}

function workspacePathFactsFromRecord(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
): EvaluateToolExecutionRequest['workspace_path'] {
  if (!options.workspacePathPolicyService || !record.input || typeof record.input !== 'object' || Array.isArray(record.input)) {
    return undefined;
  }
  const targetPath = readTargetPath(record.input as Record<string, unknown>);
  if (!targetPath) {
    return undefined;
  }
  const classification = options.workspacePathPolicyService.classifyPath({
    workspace_root: options.projectRoot,
    target_path: targetPath,
  });
  return {
    inside_workspace: classification.inside_workspace,
    protected: classification.protected,
    sensitive: classification.sensitive,
    ...(classification.workspace_path ? { workspace_path: classification.workspace_path } : {}),
  };
}

function readTargetPath(input: Record<string, unknown>): string | undefined {
  const value = input.path ?? input.targetPath ?? input.target_path ?? input.workspace_path ?? input.cwd;
  return typeof value === 'string' ? value : undefined;
}

function toPermissionCapability(capability: ToolCapability): PermissionToolCapability {
  if (
    capability === 'project_read'
    || capability === 'project_write'
    || capability === 'command_run'
    || capability === 'network_access'
    || capability === 'browser_access'
  ) {
    return capability;
  }
  return 'custom';
}

function toPermissionSideEffect(sideEffect: ToolSideEffect | undefined): PermissionToolSideEffect {
  if (sideEffect === 'project_file_operation') return 'project_file_operation';
  if (sideEffect === 'execute_command') return 'process_execution';
  if (sideEffect === 'access_network') return 'network';
  if (sideEffect === 'none') return 'none';
  return 'external';
}

function toolExecutionDecisionFromPermissionDecision(decision: ServicePermissionDecision): ToolExecutionDecision {
  if (decision.type === 'allow') {
    return {
      outcome: 'allow',
      reasonCode: decision.execution_class === 'process_execution'
        ? 'PROCESS_ALLOWED_BY_POSTURE'
        : decision.execution_class === 'workspace_mutation'
          ? 'WORKSPACE_MUTATION_ALLOWED_BY_POSTURE'
          : 'BUILTIN_READ_ALLOWED',
      reason: decision.reason,
      executionClass: legacyExecutionClass(decision.execution_class),
      executionMode: decision.execution_class === 'read_only' ? 'parallel' : 'serial',
    };
  }

  if (decision.type === 'requires_approval') {
    return {
      outcome: 'requireApproval',
      reasonCode: decision.execution_class === 'process_execution'
        ? 'PROCESS_REQUIRES_APPROVAL'
        : decision.execution_class === 'workspace_mutation'
          ? 'WORKSPACE_MUTATION_REQUIRES_APPROVAL'
          : 'CUSTOM_TOOL_REQUIRES_APPROVAL',
      reason: decision.reason,
      executionClass: legacyExecutionClass(decision.execution_class),
      executionMode: 'serial',
    };
  }

  return {
    outcome: 'reject',
    reasonCode: legacyDenialReasonCode(decision.denial_code),
    reason: decision.reason,
    executionClass: legacyExecutionClass(decision.execution_class),
    executionMode: 'serial',
  };
}

function serviceFailureDecision(message: string): ServicePermissionDecision {
  return {
    type: 'deny',
    reason: message,
    execution_class: 'unknown',
    denial_code: 'policy_denied',
  };
}

function legacyPolicyDecisionValue(decision: ServicePermissionDecision): PermissionDecision['decision'] {
  if (decision.type === 'requires_approval') return 'ask';
  return decision.type;
}

function legacyPermissionDecisionSource(decision: ServicePermissionDecision): PermissionDecision['source'] {
  if (decision.type === 'deny') {
    if (decision.denial_code === 'outside_workspace') return 'project_boundary';
    if (decision.denial_code === 'protected_path') return 'protected_path';
    if (decision.denial_code === 'rule_denied') return 'rule';
    return 'hard_guard';
  }
  return 'system_default';
}

function legacyExecutionClass(executionClass: PermissionExecutionClass): ToolExecutionDecision['executionClass'] {
  if (executionClass === 'read_only') return 'readOnly';
  if (executionClass === 'workspace_mutation') return 'workspaceMutation';
  if (executionClass === 'process_execution') return 'processExecution';
  return 'unknown';
}

function legacyDenialReasonCode(denialCode: PermissionDenialCode): ToolExecutionDecision['reasonCode'] {
  if (denialCode === 'tool_not_found') return 'TOOL_NOT_FOUND';
  if (denialCode === 'outside_workspace' || denialCode === 'protected_path') return 'PATH_OUTSIDE_WORKSPACE';
  if (denialCode === 'capability_disabled') return 'CAPABILITY_DISABLED';
  return 'CUSTOM_TOOL_REJECTED';
}

function legacySandboxLevel(executionClass: PermissionExecutionClass): NonNullable<PermissionDecision['requiredSandbox']>['level'] {
  if (executionClass === 'process_execution') return 'restricted_command';
  if (executionClass === 'network') return 'network_restricted';
  if (executionClass === 'workspace_mutation') return 'project_write';
  if (executionClass === 'read_only') return 'read_only_project';
  return 'host_restricted';
}

function escalateRisk(current: ToolRiskLevel, minimum: ToolRiskLevel): ToolRiskLevel {
  const order: ToolRiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return order.indexOf(current) >= order.indexOf(minimum) ? current : minimum;
}
