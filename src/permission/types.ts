// Defines permission-owned facts for modes, risk, decisions, approval, snapshots, and reusable records.
import type { JsonObject } from '../shared';

export type PermissionMode = 'default' | 'plan' | 'accept_edits' | 'auto';
export type PermissionOperation = 'read' | 'write' | 'exec' | 'network';
export type RiskLevel = 'safe' | 'sensitive' | 'dangerous';
export type PermissionRuleKind = 'allow' | 'ask' | 'deny';
export type PermissionSettingsSource = 'user' | 'project' | 'local';
export type CommandRiskLabel =
  | 'read_only'
  | 'search_or_list'
  | 'verification'
  | 'git_read'
  | 'git_mutation'
  | 'dependency_install'
  | 'network'
  | 'destructive'
  | 'infrastructure_or_deploy'
  | 'secret_or_env'
  | 'unknown';

export interface RiskClassification {
  level: RiskLevel;
  reasons: string[];
  normalizedTarget?: string;
  commandLabel?: CommandRiskLabel;
  matchedRules?: MatchedPermissionRule[];
}

export interface PermissionRule {
  id: string;
  kind: PermissionRuleKind;
  actionName?: string;
  operation?: PermissionOperation;
  targetPattern?: string;
  commandPattern?: string;
  primaryArgumentPattern?: string;
  source: PermissionSettingsSource;
}

export interface MatchedPermissionRule {
  id: string;
  kind: PermissionRuleKind;
  source: PermissionSettingsSource;
  reason: string;
}

export interface PermissionSettings {
  source?: PermissionSettingsSource;
  mode?: PermissionMode;
  rules: PermissionRule[];
  metadata?: JsonObject;
}

export interface PermissionPolicyInput {
  decisionId?: string;
  createdAt?: string;
  mode: PermissionMode;
  operation: PermissionOperation;
  actionName?: string;
  target?: string;
  command?: string;
  primaryArgument?: string;
  settings?: PermissionSettings;
  metadata?: JsonObject;
}

export type PolicyDecisionKind = 'allow' | 'ask' | 'deny';

export interface PolicyDecision {
  id: string;
  kind: PolicyDecisionKind;
  reason: string;
  mode: PermissionMode;
  operation: PermissionOperation;
  actionName?: string;
  target?: string;
  command?: string;
  risk: RiskClassification;
  matchedRules?: MatchedPermissionRule[];
  classifierLabel?: CommandRiskLabel;
  createdAt: string;
  metadata?: JsonObject;
}

export interface PermissionSnapshot {
  id: string;
  runId: string;
  sessionId: string;
  mode: PermissionMode;
  modeSource: PermissionSettingsSource | 'runtime_default';
  settingsSummary: { ruleCount: number; sources: PermissionSettingsSource[] };
  postureSummary: string;
  createdAt: string;
  metadata?: JsonObject;
}

export type UserDecision =
  | { kind: 'allow_once'; decidedAt: string }
  | { kind: 'allow_for_session'; decidedAt: string }
  | { kind: 'deny'; decidedAt: string }
  | { kind: 'cancel'; decidedAt: string };

export interface ApprovalRequest {
  id: string;
  runId?: string;
  sessionId?: string;
  toolCallId: string;
  toolExecutionId?: string;
  status: 'pending' | 'allowed' | 'denied' | 'cancelled' | 'expired';
  decisionKind: 'ask';
  policyDecision: PolicyDecision;
  requestedScope?: 'once' | 'session';
  createdAt: string;
  userDecision?: UserDecision;
  resolvedAt?: string;
  metadata?: JsonObject;
}

export interface ApprovalRecord {
  id: string;
  approvalRequestId: string;
  userDecision: UserDecision;
  resolvedAt: string;
  scope: 'once' | 'session' | 'none';
  runId?: string;
  sessionId?: string;
  toolCallId: string;
}

export interface PermissionRecord {
  id: string;
  decision: PolicyDecision;
  userDecision: UserDecision;
  operation: PermissionOperation;
  target: string;
  scope: 'session';
  sessionId?: string;
  runId?: string;
  sourceApprovalRequestId?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface PermissionEvaluator {
  evaluate(input: PermissionPolicyInput): PolicyDecision;
}
