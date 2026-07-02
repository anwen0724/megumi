// Evaluates deterministic host-runtime decisions for provider tool calls.
import type {
  ToolCapability,
  ToolExecutionDecision,
  ToolExecutionMode,
  ToolRiskLevel,
  ToolSideEffect,
} from '@megumi/shared/tool';

export interface ToolExecutionDecisionInput {
  toolName: string;
  parsedArguments: unknown;
  toolFacts: ToolExecutionDecisionToolFacts | undefined;
  permissionPosture: string;
  permissionDecision: ToolExecutionPolicyDecision;
  runtimeCapabilityPolicy: {
    customToolsEnabled: boolean;
    processExecutionEnabled: boolean;
  };
}

export interface ToolExecutionPolicyDecision {
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
}

export interface ToolExecutionDecisionToolFacts {
  registeredToolName: string;
  sourceId: string;
  namespace: string;
  sourceToolName: string;
  capabilities?: readonly ToolCapability[];
  riskLevel?: ToolRiskLevel | string;
  sideEffect?: ToolSideEffect;
  executionMode?: ToolExecutionMode;
}

export function evaluateToolExecutionDecision(input: ToolExecutionDecisionInput): ToolExecutionDecision {
  void input.toolName;
  void input.parsedArguments;
  void input.permissionPosture;

  if (!input.toolFacts) {
    return reject('TOOL_NOT_FOUND', 'Tool is not present in available registered tools.', 'unknown');
  }

  const executionClass = classifyExecution(input.toolFacts);
  const executionMode: ToolExecutionMode = executionClass === 'readOnly' ? 'parallel' : 'serial';

  if (executionClass === 'processExecution' && !input.runtimeCapabilityPolicy.processExecutionEnabled) {
    return reject('CAPABILITY_DISABLED', 'Process execution is disabled by runtime capability policy.', executionClass);
  }

  if (input.toolFacts.sourceId !== 'built_in' && !input.runtimeCapabilityPolicy.customToolsEnabled) {
    return reject('CUSTOM_TOOL_REJECTED', 'Custom tools are disabled by runtime capability policy.', 'unknown');
  }

  if (input.permissionDecision.decision === 'deny') {
    return reject(reasonCodeForDenied(executionClass), input.permissionDecision.reason, executionClass);
  }

  if (input.permissionDecision.decision === 'ask') {
    return {
      outcome: 'requireApproval',
      reasonCode: reasonCodeForApproval(executionClass),
      reason: input.permissionDecision.reason,
      executionClass,
      executionMode,
    };
  }

  return {
    outcome: 'allow',
    reasonCode: reasonCodeForAllow(executionClass),
    reason: input.permissionDecision.reason,
    executionClass,
    executionMode,
  };
}

function classifyExecution(entry: ToolExecutionDecisionToolFacts): ToolExecutionDecision['executionClass'] {
  const capabilities = new Set(entry.capabilities ?? []);
  if (capabilities.has('command_run')) {
    return 'processExecution';
  }
  if (capabilities.has('project_write') || entry.sideEffect === 'project_file_operation') {
    return 'workspaceMutation';
  }
  if (capabilities.has('project_read') || entry.sideEffect === 'none') {
    return 'readOnly';
  }
  return 'unknown';
}

function reject(
  reasonCode: ToolExecutionDecision['reasonCode'],
  reason: string,
  executionClass: ToolExecutionDecision['executionClass'],
): ToolExecutionDecision {
  return {
    outcome: 'reject',
    reasonCode,
    reason,
    executionClass,
    executionMode: 'serial',
  };
}

function reasonCodeForApproval(
  executionClass: ToolExecutionDecision['executionClass'],
): ToolExecutionDecision['reasonCode'] {
  if (executionClass === 'workspaceMutation') {
    return 'WORKSPACE_MUTATION_REQUIRES_APPROVAL';
  }
  if (executionClass === 'processExecution') {
    return 'PROCESS_REQUIRES_APPROVAL';
  }
  return 'CUSTOM_TOOL_REQUIRES_APPROVAL';
}

function reasonCodeForAllow(
  executionClass: ToolExecutionDecision['executionClass'],
): ToolExecutionDecision['reasonCode'] {
  if (executionClass === 'workspaceMutation') {
    return 'WORKSPACE_MUTATION_ALLOWED_BY_POSTURE';
  }
  if (executionClass === 'processExecution') {
    return 'PROCESS_ALLOWED_BY_POSTURE';
  }
  return 'BUILTIN_READ_ALLOWED';
}

function reasonCodeForDenied(
  executionClass: ToolExecutionDecision['executionClass'],
): ToolExecutionDecision['reasonCode'] {
  if (executionClass === 'readOnly') {
    return 'PATH_OUTSIDE_WORKSPACE';
  }
  if (executionClass === 'processExecution') {
    return 'CAPABILITY_DISABLED';
  }
  return 'CUSTOM_TOOL_REJECTED';
}
