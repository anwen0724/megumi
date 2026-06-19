// Implements permission policy decisions and audit facts without executing tools or mutating workspace files.
import type { JsonObject } from '../shared';
import type {
  ApprovalRecord,
  ApprovalRequest,
  CommandRiskLabel,
  MatchedPermissionRule,
  PermissionMode,
  PermissionOperation,
  PermissionPolicyInput,
  PermissionRecord,
  PermissionSettings,
  PermissionSettingsSource,
  PermissionSnapshot,
  PolicyDecision,
  RiskClassification,
  RiskLevel,
  UserDecision,
} from './types';
import { classifyProjectPathRisk } from './path-risk';

export function evaluatePermissionPolicy(input: PermissionPolicyInput): PolicyDecision {
  const risk = classifyRisk(input);
  const matchedRules = matchPermissionRules(input);
  const base = {
    id: input.decisionId ?? `policy-decision_${input.operation}_${input.target ?? input.command ?? input.actionName ?? 'unknown'}`,
    mode: input.mode,
    operation: input.operation,
    ...(input.actionName ? { actionName: input.actionName } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.command ? { command: input.command } : {}),
    risk,
    ...(risk.commandLabel ? { classifierLabel: risk.commandLabel } : {}),
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  if (risk.reasons.includes('protected_path') || risk.reasons.includes('project_escape')) {
    const reason = risk.reasons.includes('protected_path')
      ? input.settings ? 'hard_guard_protected_path' : 'dangerous_target'
      : 'hard_guard_project_escape';
    return { ...base, kind: 'deny', reason, matchedRules };
  }
  if (risk.reasons.includes('dangerous_command') || risk.reasons.includes('secret_or_env_command')) {
    return { ...base, kind: 'deny', reason: risk.reasons[0], matchedRules };
  }
  if (matchedRules.some((rule) => rule.kind === 'deny')) {
    return { ...base, kind: 'deny', reason: 'matched_deny_rule', matchedRules };
  }
  if (matchedRules.some((rule) => rule.kind === 'ask')) {
    return { ...base, kind: 'ask', reason: 'matched_ask_rule', matchedRules };
  }
  if (matchedRules.some((rule) => rule.kind === 'allow')) {
    return { ...base, kind: 'allow', reason: 'matched_allow_rule', matchedRules };
  }

  if (input.mode === 'plan' && input.operation !== 'read') {
    return { ...base, kind: 'deny', reason: 'plan_mode_is_read_only' };
  }

  if (input.operation === 'read' && risk.level === 'safe') {
    return { ...base, kind: 'allow', reason: 'safe_read' };
  }

  if (input.mode === 'accept_edits' && input.operation === 'write' && !risk.reasons.includes('sensitive_path')) {
    return { ...base, kind: 'allow', reason: 'accept_edits_allows_workspace_writes' };
  }

  if (input.mode === 'auto' && input.operation === 'write' && risk.level === 'safe') {
    return { ...base, kind: 'allow', reason: 'auto_allows_safe_workspace_write' };
  }

  return { ...base, kind: 'ask', reason: `${input.operation}_requires_approval` };
}

export function classifyRisk(input: PermissionPolicyInput): RiskClassification {
  const reasons: string[] = [];
  const pathRisk = classifyProjectPathRisk(input.target);
  if (pathRisk.level === 'project_escape') {
    reasons.push('project_escape');
  }
  if (pathRisk.level === 'protected') {
    reasons.push('protected_path');
  }
  if (pathRisk.level === 'sensitive') {
    reasons.push('sensitive_path');
  }

  const commandRisk = input.command ? classifyCommandRisk(input.command) : undefined;
  if (commandRisk) {
    reasons.push(...commandRisk.reasons);
  }

  const level =
    pathRisk.level === 'project_escape' || pathRisk.level === 'protected' || commandRisk?.level === 'dangerous'
      ? 'dangerous'
      : pathRisk.level === 'sensitive' || commandRisk?.level === 'sensitive' || input.operation !== 'read'
        ? 'sensitive'
        : 'safe';

  return {
    level,
    reasons: reasons.length > 0 ? reasons : ['safe_operation'],
    normalizedTarget: pathRisk.normalizedPath,
    ...(commandRisk ? { commandLabel: commandRisk.label } : {}),
  };
}

export function classifyCommandRisk(command: string): { label: CommandRiskLabel; level: RiskLevel; reasons: string[] } {
  const value = command.trim().toLowerCase();
  if (!value) {
    return { label: 'unknown', level: 'sensitive', reasons: ['unknown_command'] };
  }
  if (/\brm\s+-rf\b|\bdel\s+\/s\b|\bformat\b|\bshutdown\b/.test(value)) {
    return { label: 'destructive', level: 'dangerous', reasons: ['dangerous_command'] };
  }
  if (/(^|\s)(cat|type|printenv|env)\s+.*\.env/.test(value)) {
    return { label: 'secret_or_env', level: 'dangerous', reasons: ['secret_or_env_command'] };
  }
  if (/^git\s+(status|diff|log|show|branch)\b/.test(value)) {
    return { label: 'git_read', level: 'safe', reasons: ['git_read'] };
  }
  if (/^git\s+(push|commit|reset|clean|checkout|switch|merge|rebase)\b/.test(value)) {
    return { label: 'git_mutation', level: 'sensitive', reasons: ['git_mutation'] };
  }
  if (/\b(npm|pnpm|yarn)\s+(install|add|remove)\b/.test(value)) {
    return { label: 'dependency_install', level: 'sensitive', reasons: ['dependency_install'] };
  }
  if (/\b(curl|wget|ssh|scp)\b/.test(value)) {
    return { label: 'network', level: 'sensitive', reasons: ['network_command'] };
  }
  if (/\b(kubectl|terraform|docker\s+push|vercel|netlify)\b/.test(value)) {
    return { label: 'infrastructure_or_deploy', level: 'sensitive', reasons: ['infrastructure_or_deploy'] };
  }
  if (/^(ls|dir|cat|type|grep|rg|find)\b/.test(value)) {
    return { label: 'search_or_list', level: 'safe', reasons: ['search_or_list'] };
  }
  if (/\b(npm|pnpm|yarn)\s+(test|run test|run build|run lint)\b/.test(value)) {
    return { label: 'verification', level: 'safe', reasons: ['verification'] };
  }
  return { label: 'unknown', level: 'sensitive', reasons: ['unknown_command'] };
}

export function mergePermissionSettings(settings: PermissionSettings[]): PermissionSettings {
  const orderedSources: PermissionSettingsSource[] = ['user', 'project', 'local'];
  const ordered = [...settings].sort((left, right) =>
    orderedSources.indexOf(left.source ?? 'user') - orderedSources.indexOf(right.source ?? 'user'),
  );
  return {
    mode: [...ordered].reverse().find((item) => item.mode)?.mode,
    rules: ordered.flatMap((item) => item.rules.map((rule) => ({ ...rule, source: rule.source ?? item.source ?? 'user' }))),
    metadata: {
      sources: ordered.map((item) => item.source).filter((source): source is PermissionSettingsSource => Boolean(source)),
    },
  };
}

export function createApprovalRequest(input: {
  id: string;
  toolCallId: string;
  decision: PolicyDecision;
  createdAt: string;
  runId?: string;
  sessionId?: string;
  toolExecutionId?: string;
  requestedScope?: 'once' | 'session';
  metadata?: JsonObject;
}): ApprovalRequest {
  if (input.decision.kind !== 'ask') {
    throw new Error('Approval request can only be created for ask decisions.');
  }
  return {
    id: input.id,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    toolCallId: input.toolCallId,
    ...(input.toolExecutionId ? { toolExecutionId: input.toolExecutionId } : {}),
    status: 'pending',
    decisionKind: 'ask',
    policyDecision: input.decision,
    ...(input.requestedScope ? { requestedScope: input.requestedScope } : {}),
    createdAt: input.createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function resolveApprovalRequest(input: {
  approval: ApprovalRequest;
  userDecision: UserDecision;
}): ApprovalRequest {
  if (input.approval.status !== 'pending') {
    throw new Error('Approval request is already resolved.');
  }

  const status = input.userDecision.kind === 'deny'
    ? 'denied'
    : input.userDecision.kind === 'cancel'
      ? 'cancelled'
      : 'allowed';

  return {
    ...input.approval,
    status,
    userDecision: input.userDecision,
    resolvedAt: input.userDecision.decidedAt,
  };
}

export function createPermissionRecord(input: {
  id: string;
  decision: PolicyDecision;
  userDecision: UserDecision;
  operation: PermissionOperation;
  target: string;
  scope?: 'session';
  sessionId?: string;
  runId?: string;
  sourceApprovalRequestId?: string;
  createdAt: string;
  expiresAt?: string;
}): PermissionRecord {
  return {
    id: input.id,
    decision: input.decision,
    userDecision: input.userDecision,
    operation: input.operation,
    target: input.target,
    scope: input.scope ?? 'session',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sourceApprovalRequestId ? { sourceApprovalRequestId: input.sourceApprovalRequestId } : {}),
    createdAt: input.createdAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}

export function isPermissionRecordReusable(record: PermissionRecord, input: {
  operation: PermissionOperation;
  target: string;
  now: string;
}): boolean {
  if (record.userDecision.kind === 'deny' || record.userDecision.kind === 'cancel') {
    return false;
  }
  const pathRisk = classifyProjectPathRisk(input.target);
  if (pathRisk.level === 'protected' || pathRisk.level === 'project_escape') {
    return false;
  }
  if (record.operation !== input.operation || record.target !== input.target) {
    return false;
  }
  return !record.expiresAt || record.expiresAt > input.now;
}

export function createPermissionSnapshot(input: {
  id: string;
  runId: string;
  sessionId: string;
  mode: PermissionMode;
  modeSource: PermissionSettingsSource | 'runtime_default';
  settingsSummary: { ruleCount: number; sources: PermissionSettingsSource[] };
  createdAt: string;
  metadata?: JsonObject;
}): PermissionSnapshot {
  return {
    ...input,
    postureSummary: createPermissionPostureSummary(input.mode),
  };
}

export function createPermissionPostureSummary(mode: PermissionMode): string {
  if (mode === 'plan') {
    return 'Permission mode is plan. Mutation, exec, and network actions require approval or are blocked.';
  }
  if (mode === 'accept_edits') {
    return 'Permission mode is accept_edits. Safe workspace edits may proceed, but sensitive or protected actions still require approval or are blocked.';
  }
  if (mode === 'auto') {
    return 'Permission mode is auto. Safe classified actions may proceed automatically; unknown or risky actions require approval or are blocked.';
  }
  return 'Permission mode is default. Safe reads may proceed; writes, exec, network, and sensitive actions require approval or are blocked.';
}

export function createApprovalRecord(input: {
  id: string;
  approval: ApprovalRequest;
  userDecision: UserDecision;
}): ApprovalRecord {
  return {
    id: input.id,
    approvalRequestId: input.approval.id,
    userDecision: input.userDecision,
    resolvedAt: input.userDecision.decidedAt,
    scope: input.userDecision.kind === 'allow_for_session' ? 'session' : input.userDecision.kind === 'allow_once' ? 'once' : 'none',
    ...(input.approval.runId ? { runId: input.approval.runId } : {}),
    ...(input.approval.sessionId ? { sessionId: input.approval.sessionId } : {}),
    toolCallId: input.approval.toolCallId,
  };
}

function matchPermissionRules(input: PermissionPolicyInput): MatchedPermissionRule[] {
  return (input.settings?.rules ?? []).flatMap((rule) => {
    if (rule.actionName && rule.actionName !== input.actionName) {
      return [];
    }
    if (rule.operation && rule.operation !== input.operation) {
      return [];
    }
    if (rule.targetPattern && (!input.target || !globToRegExp(rule.targetPattern).test(input.target))) {
      return [];
    }
    if (rule.commandPattern && (!input.command || !globToRegExp(rule.commandPattern).test(input.command))) {
      return [];
    }
    if (rule.primaryArgumentPattern && (!input.primaryArgument || !globToRegExp(rule.primaryArgumentPattern).test(input.primaryArgument))) {
      return [];
    }
    return [{ id: rule.id, kind: rule.kind, source: rule.source, reason: `matched_${rule.kind}_rule` }];
  });
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}
