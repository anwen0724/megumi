/*
 * Applies rule precedence, Permission mode defaults, and risk assessment to resolved operations.
 */
import type { JsonObject } from '@megumi/tools';
import {
  createApprovalSubject,
  type ApprovalOption,
  type ApprovalSubject,
  type PermissionDecision,
} from './approval';
import type { EvaluateToolCallRequest, PermissionOperation } from './permission-operation';
import {
  matchesPermissionRule,
  type PermissionRule,
  type PermissionSettings,
  type SafetyAssessment,
} from './permission-rules';

export interface PermissionPolicyResult {
  readonly decision: PermissionDecision;
  readonly approvalSubject: ApprovalSubject;
}

export function evaluatePermissionPolicy(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly operations: readonly PermissionOperation[];
  readonly criticalInput: EvaluateToolCallRequest['toolInput'];
  readonly riskFacts: JsonObject;
  readonly permissionSettings: PermissionSettings;
}): PermissionPolicyResult {
  const operations = [...request.operations];
  const safetyAssessment = highestSafety(
    operations.map((operation) => assessOperation(operation, request.riskFacts)),
  );
  const safetySummary = safetySummaryFor(safetyAssessment, operations);
  const approvalSubject = createApprovalSubject({
    toolCallId: request.evaluation.toolCallId,
    toolIdentity: operations[0].context.toolIdentity,
    criticalInput: request.criticalInput,
    operations,
    safetyAssessment,
    riskFacts: request.riskFacts,
  });
  const settings = {
    ...request.permissionSettings,
    mode: request.evaluation.permissionMode,
  };

  if (matchesAny(settings.deny, operations)) {
    return {
      approvalSubject,
      decision: {
        type: 'deny',
        operations,
        safetyAssessment,
        safetySummary,
        reason: 'Denied by an explicit Permission rule.',
        denialCode: 'rule_denied',
      },
    };
  }
  if (matchesAny(settings.ask, operations)) {
    return {
      approvalSubject,
      decision: approvalDecision({
        evaluation: request.evaluation,
        operations,
        safetyAssessment,
        safetySummary,
        approvalSubject,
        reason: 'Approval required by an explicit Permission rule.',
      }),
    };
  }

  const allExplicitlyAllowed = operations.every((operation) => (
    settings.allow.some((rule) => matchesPermissionRule(rule, operation))
  ));
  if (allExplicitlyAllowed) {
    return {
      approvalSubject,
      decision: {
        type: 'allow',
        operations,
        safetyAssessment,
        safetySummary,
        reason: 'Allowed by an explicit Permission rule.',
      },
    };
  }

  const allowByMode = settings.mode === 'full_access'
    || (settings.mode === 'auto' && safetyAssessment === 'safe')
    || (settings.mode === 'ask' && operations.every(isAskModeImplicitlySafe));
  return allowByMode
    ? {
        approvalSubject,
        decision: {
          type: 'allow',
          operations,
          safetyAssessment,
          safetySummary,
          reason: `Allowed by ${settings.mode} mode.`,
        },
      }
    : {
        approvalSubject,
        decision: approvalDecision({
          evaluation: request.evaluation,
          operations,
          safetyAssessment,
          safetySummary,
          approvalSubject,
          reason: `Approval required by ${settings.mode} mode.`,
        }),
      };
}

function assessOperation(operation: PermissionOperation, riskFacts: JsonObject): SafetyAssessment {
  if (operation.action === 'agent.context.activate') return 'safe';
  if (operation.action === 'external.invoke') return 'prohibited';
  if (operation.action === 'workspace.read' || operation.action === 'workspace.write') {
    const path = objectFact(riskFacts.path);
    if (!path || path.classified !== true) return 'prohibited';
    return path.insideWorkspace === true && path.protected !== true && path.sensitive !== true
      ? 'safe'
      : 'prohibited';
  }
  if (operation.action === 'network.search') return 'safe';
  if (operation.action === 'network.fetch') {
    const network = objectFact(riskFacts.network);
    return network?.valid === true ? 'safe' : 'prohibited';
  }
  if (operation.action === 'process.execute') {
    const shell = objectFact(riskFacts.shell);
    const classification = shell?.classification;
    if (classification === 'destructive'
      || classification === 'infrastructure_or_deploy'
      || classification === 'secret_or_env'
      || classification === 'nested_shell'
      || classification === 'unknown_shell') {
      return 'prohibited';
    }
    if (classification === 'read_only'
      || classification === 'verification'
      || classification === 'search_or_list'
      || classification === 'git_read') {
      return 'safe';
    }
    return 'potentially_unsafe';
  }
  return 'prohibited';
}

function approvalDecision(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly operations: PermissionOperation[];
  readonly safetyAssessment: SafetyAssessment;
  readonly safetySummary: string;
  readonly approvalSubject: ApprovalSubject;
  readonly reason: string;
}): PermissionDecision {
  const highRisk = request.safetyAssessment === 'prohibited';
  const tool = request.evaluation.registeredTool;
  const options: ApprovalOption[] = [
    {
      optionId: `once:${request.evaluation.toolCallId}`,
      scope: 'once',
      display: {
        label: highRisk ? 'Allow once (high risk)' : 'Once',
        description: highRisk
          ? 'This target is outside the normal safety boundary. Allow only this Tool Call.'
          : 'Allow only this Tool Call.',
      },
      effect: { type: 'current_tool_call' },
    },
    {
      optionId: `session:${tool.identity.sourceId}:${tool.identity.namespace}:${tool.identity.sourceToolName}`,
      scope: 'session',
      display: {
        label: highRisk ? 'Allow Tool for Session (high risk)' : 'Session',
        description: highRisk
          ? 'This target is outside the normal safety boundary. Allow this Tool throughout the current Session.'
          : 'Allow this Tool for the current Session.',
      },
      effect: {
        type: 'session_tool_grant',
        rule: {
          source: 'session',
          source_id: request.evaluation.sessionId,
          target: {
            kind: 'tool',
            tool_identity: {
              source_id: tool.identity.sourceId,
              namespace: tool.identity.namespace,
              source_tool_name: tool.identity.sourceToolName,
            },
          },
        },
      },
    },
  ];
  return {
    type: 'requires_approval',
    operations: request.operations,
    safetyAssessment: request.safetyAssessment,
    safetySummary: request.safetySummary,
    reason: request.reason,
    options,
    defaultOptionId: options[0].optionId,
    subjectFingerprint: request.approvalSubject.fingerprint,
  };
}

function matchesAny(rules: readonly PermissionRule[], operations: readonly PermissionOperation[]): boolean {
  return rules.some((rule) => operations.some((operation) => matchesPermissionRule(rule, operation)));
}

function highestSafety(values: readonly SafetyAssessment[]): SafetyAssessment {
  if (values.includes('prohibited')) return 'prohibited';
  if (values.includes('potentially_unsafe')) return 'potentially_unsafe';
  return 'safe';
}

function safetySummaryFor(
  safetyAssessment: SafetyAssessment,
  operations: readonly PermissionOperation[],
): string {
  const actionNames = [...new Set(operations.map((operation) => operation.action))].join(', ');
  if (safetyAssessment === 'safe') return `Known low-risk operation: ${actionNames}.`;
  if (safetyAssessment === 'potentially_unsafe') {
    return `Operation may cause external or mutable effects: ${actionNames}.`;
  }
  return `Operation is outside the normal safety boundary: ${actionNames}.`;
}

function isAskModeImplicitlySafe(operation: PermissionOperation): boolean {
  return operation.action === 'workspace.read' || operation.action === 'agent.context.activate';
}

function objectFact(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
