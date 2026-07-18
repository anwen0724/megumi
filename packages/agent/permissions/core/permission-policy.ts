/*
 * Pure tool execution permission policy for the Permission Service.
 * Callers provide tool, settings, workspace, and runtime capability facts explicitly.
 */
import type {
  EvaluateToolExecutionRequest,
  EvaluateToolExecutionResult,
  PermissionDecision,
  PermissionExecutionClass,
  PermissionSettings,
  RegisteredToolPermissionFacts,
} from '../contracts/permission-contracts';
import { matchesPermissionRule } from './permission-rule-matcher';
import { classifyCommand } from './command-classifier';

const EMPTY_PERMISSION_SETTINGS: PermissionSettings = {
  allow: [],
  ask: [],
  deny: [],
};

export function evaluateToolExecution(
  request: EvaluateToolExecutionRequest,
): EvaluateToolExecutionResult {
  if (!request.registered_tool) {
    return ok(deny('tool_not_found', 'unknown', 'Tool is not present in available registered tools.'));
  }

  const executionClass = classifyExecution(request.registered_tool);
  const capabilityDenied = evaluateRuntimeCapabilityPolicy(request.registered_tool, executionClass, request);
  if (capabilityDenied) {
    return ok(capabilityDenied);
  }

  if (request.workspace_path?.inside_workspace === false) {
    return ok(deny('outside_workspace', executionClass, 'Workspace path is outside the current workspace.'));
  }

  if (request.workspace_path?.protected === true) {
    return ok(deny('protected_path', executionClass, 'Protected workspace paths cannot be accessed by this request.'));
  }

  const settings = request.permission_settings ?? EMPTY_PERMISSION_SETTINGS;
  if (settings.deny.some((rule) => matchesPermissionRule(rule, {
    tool_name: request.tool_name,
    tool_input: request.tool_input,
  }).matched)) {
    return ok(deny('rule_denied', executionClass, 'Denied by matching permission rule.'));
  }

  if (settings.allow.some((rule) => matchesPermissionRule(rule, {
    tool_name: request.tool_name,
    tool_input: request.tool_input,
  }).matched)) {
    return ok(allow(executionClass, 'Allowed by matching permission rule.'));
  }

  if (settings.ask.some((rule) => matchesPermissionRule(rule, {
    tool_name: request.tool_name,
    tool_input: request.tool_input,
  }).matched)) {
    return ok(requiresApproval(executionClass, 'Approval required by matching permission rule.'));
  }

  if (request.tool_name === 'run_command' && isDestructiveCommandInput(request.tool_input)) {
    return ok(deny('destructive_command', executionClass, 'Destructive command is denied by permission policy.'));
  }

  if (executionClass === 'read_only') {
    return ok(allow(executionClass, 'Conservative baseline allows read-only tools.'));
  }

  return ok(requiresApproval(executionClass, 'Conservative baseline requires approval for side effects.'));
}

function evaluateRuntimeCapabilityPolicy(
  tool: RegisteredToolPermissionFacts,
  executionClass: PermissionExecutionClass,
  request: EvaluateToolExecutionRequest,
): PermissionDecision | undefined {
  if (executionClass === 'process_execution' && !request.runtime_capability_policy.process_execution_enabled) {
    return deny('capability_disabled', executionClass, 'Process execution is disabled by runtime capability policy.');
  }

  if (executionClass === 'network' && !request.runtime_capability_policy.network_enabled) {
    return deny('capability_disabled', executionClass, 'Network access is disabled by runtime capability policy.');
  }

  if (isCustomTool(tool) && !request.runtime_capability_policy.custom_tools_enabled) {
    return deny('capability_disabled', 'custom_tool', 'Custom tools are disabled by runtime capability policy.');
  }

  return undefined;
}

function classifyExecution(tool: RegisteredToolPermissionFacts): PermissionExecutionClass {
  if (isCustomTool(tool)) {
    return 'custom_tool';
  }
  if (tool.capabilities.includes('command_run') || tool.side_effect === 'process_execution') {
    return 'process_execution';
  }
  if (tool.capabilities.includes('network_access') || tool.capabilities.includes('browser_access') || tool.side_effect === 'network') {
    return 'network';
  }
  if (tool.capabilities.includes('project_write') || tool.side_effect === 'project_file_operation') {
    return 'workspace_mutation';
  }
  if (tool.capabilities.includes('project_read') || tool.side_effect === 'none') {
    return 'read_only';
  }
  return 'unknown';
}

function isCustomTool(tool: RegisteredToolPermissionFacts): boolean {
  return tool.source_id !== 'built_in' || tool.capabilities.includes('custom');
}

function isDestructiveCommandInput(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' && classifyCommand(command).label === 'destructive';
}

function ok(decision: PermissionDecision): EvaluateToolExecutionResult {
  return {
    status: 'ok',
    decision,
  };
}

function allow(executionClass: PermissionExecutionClass, reason: string): PermissionDecision {
  return {
    type: 'allow',
    reason,
    execution_class: executionClass,
  };
}

function deny(
  denialCode: Extract<PermissionDecision, { type: 'deny' }>['denial_code'],
  executionClass: PermissionExecutionClass,
  reason: string,
): PermissionDecision {
  return {
    type: 'deny',
    reason,
    execution_class: executionClass,
    denial_code: denialCode,
  };
}

function requiresApproval(executionClass: PermissionExecutionClass, reason: string): PermissionDecision {
  return {
    type: 'requires_approval',
    reason,
    execution_class: executionClass,
    approval: {
      allowed_scopes: ['once', 'session'],
      default_scope: 'once',
    },
  };
}
