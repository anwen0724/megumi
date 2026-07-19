/* Applies safety assessment, explicit rule precedence, and permission mode defaults. */
import type {
  ApprovalOption, EvaluateToolCallRequest, EvaluateToolCallResult, PermissionDecision, PermissionOperation,
  PermissionRule, SafetyAssessment,
} from '../contracts/permission-contracts';
import { classifyCommand } from './command-classifier';
import { resolvePermissionOperations } from './operation-resolver';
import { matchesPermissionRule } from './permission-rule-matcher';

export function evaluateToolCall(request: EvaluateToolCallRequest): EvaluateToolCallResult {
  const operations = resolvePermissionOperations(request);
  const safety = highestSafety(operations.map((operation) => assessOperation(operation, request)));
  const settings = request.permission_settings;
  if (matchesAny(settings.deny, operations)) return ok(operations, { type: 'deny', operations, safety_assessment: safety, reason: 'Denied by an explicit permission rule.', denial_code: 'rule_denied' });
  if (matchesAny(settings.ask, operations)) return ok(operations, approvalDecision(operations, safety, request, 'Approval required by an explicit permission rule.'));

  const allExplicitlyAllowed = operations.every((operation) => settings.allow.some((rule) => matchesPermissionRule(rule, operation)));
  if (allExplicitlyAllowed) return ok(operations, { type: 'allow', operations, safety_assessment: safety, reason: 'Allowed by an explicit permission rule.' });

  const mode = request.permission_mode;
  const allowByMode = mode === 'full_access' || (mode === 'auto' && safety === 'safe')
    || (mode === 'ask' && operations.every(isAskModeImplicitlySafe));
  return allowByMode
    ? ok(operations, { type: 'allow', operations, safety_assessment: safety, reason: `Allowed by ${request.permission_mode} mode.` })
    : ok(operations, approvalDecision(operations, safety, request, `Approval required by ${request.permission_mode} mode.`));
}

function assessOperation(operation: PermissionOperation, request: EvaluateToolCallRequest): SafetyAssessment {
  if (operation.action === 'agent.context.activate') return 'safe';
  if (operation.action === 'external.invoke') return 'prohibited';
  if (operation.action === 'workspace.read' || operation.action === 'workspace.write') {
    const path = request.workspace_path;
    return path && (!path.inside_workspace || path.protected || path.sensitive) ? 'prohibited' : 'safe';
  }
  if (operation.action === 'network.search') return 'safe';
  if (operation.action === 'network.fetch') return 'safe';
  if (operation.action === 'process.execute') {
    const classification = classifyCommand(operation.resource?.id ?? '');
    if (['destructive', 'infrastructure_or_deploy', 'secret_or_env'].includes(classification.label)) return 'prohibited';
    if (['read_only', 'verification', 'search_or_list', 'git_read'].includes(classification.label)) return 'safe';
    return 'potentially_unsafe';
  }
  return 'prohibited';
}

function isAskModeImplicitlySafe(operation: PermissionOperation): boolean {
  return operation.action === 'workspace.read' || operation.action === 'agent.context.activate';
}

function approvalDecision(operations: PermissionOperation[], safety: SafetyAssessment, request: EvaluateToolCallRequest, reason: string): PermissionDecision {
  const highRisk = safety === 'prohibited';
  const options: ApprovalOption[] = [{
    option_id: `once:${request.tool_call_id}`, scope: 'once',
    display: {
      label: highRisk ? 'Allow once (high risk)' : 'Once',
      description: highRisk ? 'This target is outside the normal safety boundary. Allow only this tool call.' : 'Allow only this tool call.',
    },
    effect: { type: 'current_tool_call' },
  }, {
    option_id: `session:${request.registered_tool.source_id}:${request.registered_tool.namespace}:${request.registered_tool.source_tool_name}`,
    scope: 'session', display: {
      label: highRisk ? 'Allow tool for session (high risk)' : 'Session',
      description: highRisk
        ? 'This target is outside the normal safety boundary. Allow this tool throughout the current session.'
        : 'Allow this tool for the current session.',
    },
    effect: { type: 'session_tool_grant', rule: {
      source: 'session', source_id: request.session_id,
      target: { kind: 'tool', tool_identity: {
        source_id: request.registered_tool.source_id, namespace: request.registered_tool.namespace,
        source_tool_name: request.registered_tool.source_tool_name,
      } },
    } },
  }];
  return { type: 'requires_approval', operations, safety_assessment: safety, reason, options, default_option_id: options[0].option_id };
}

function matchesAny(rules: PermissionRule[], operations: PermissionOperation[]): boolean {
  return rules.some((rule) => operations.some((operation) => matchesPermissionRule(rule, operation)));
}
function highestSafety(values: SafetyAssessment[]): SafetyAssessment {
  return values.includes('prohibited') ? 'prohibited' : values.includes('potentially_unsafe') ? 'potentially_unsafe' : 'safe';
}
function ok(operations: PermissionOperation[], decision: PermissionDecision): EvaluateToolCallResult { return { status: 'ok', operations, decision }; }
