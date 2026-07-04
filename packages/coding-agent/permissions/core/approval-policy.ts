/*
 * Pure approval decision policy for Permissions.
 * It validates decisions and calculates permission state changes without storage access.
 */
import type {
  ApplyApprovalDecisionRequest,
  ApplyApprovalDecisionResult,
  ApprovalDecisionRejectionReason,
  PermissionStateChange,
  ValidateApprovalDecisionRequest,
  ValidateApprovalDecisionResult,
} from '../contracts/approval-policy-contracts';
import type { PermissionRule } from '../contracts/permission-contracts';

export function validateApprovalDecision(
  request: ValidateApprovalDecisionRequest,
): ValidateApprovalDecisionResult {
  if (request.approval_request.status !== 'pending') {
    return rejected('approval_request_not_pending', 'Approval request is not pending.');
  }

  if (request.current_run_status !== 'waiting_for_approval') {
    return rejected('run_not_waiting_for_approval', 'Run is no longer waiting for approval.');
  }

  if (request.decision.approval_request_id !== request.approval_request.approval_request_id) {
    return rejected('approval_subject_mismatch', 'Approval decision does not match the pending request.');
  }

  if (!request.approval_request.allowed_scopes.includes(request.decision.scope)) {
    return rejected('approval_scope_not_allowed', 'Approval scope is not allowed by this request.');
  }

  if (request.decision.decision === 'approved' && request.original_permission_decision.type === 'deny') {
    return rejected('decision_not_allowed', 'Denied permission decisions cannot be approved by ordinary approval.');
  }

  return { status: 'accepted' };
}

export function calculateApprovalStateChange(
  request: ApplyApprovalDecisionRequest,
): ApplyApprovalDecisionResult {
  if (request.decision.decision === 'denied' || request.decision.scope === 'once') {
    return applied({ type: 'none' });
  }

  const rule = createSessionPermissionRule(request);
  if (!rule) {
    return {
      status: 'failed',
      failure: {
        code: 'stable_permission_rule_unavailable',
        message: 'A stable session permission rule could not be generated for this approval request.',
      },
    };
  }

  return applied({
    type: 'settings_rule_change',
    rule,
  });
}

function createSessionPermissionRule(request: ApplyApprovalDecisionRequest): PermissionRule | undefined {
  const pattern = createSessionPermissionPattern(
    request.approval_request.subject.tool_name,
    request.approval_request.subject.input,
  );
  if (!pattern) {
    return undefined;
  }

  return {
    source: 'session',
    source_id: request.session_id,
    pattern,
  };
}

function createSessionPermissionPattern(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (toolName === 'run_command') {
    return typeof record.command === 'string' && record.command.trim()
      ? `tool:run_command|command=${normalizeValue(record.command)}`
      : undefined;
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const path = readString(record, ['path', 'target_path', 'workspace_path']);
    return path ? `tool:${toolName}|path=${normalizeValue(path)}` : undefined;
  }

  const stableField = Object.entries(record)
    .find(([_, value]) => isStablePrimitive(value));
  if (!stableField) {
    return undefined;
  }

  const [field, value] = stableField;
  return `tool:${toolName}|${field}=${normalizeValue(String(value))}`;
}

function readString(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function isStablePrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizeValue(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

function applied(permissionStateChange: PermissionStateChange): ApplyApprovalDecisionResult {
  return {
    status: 'applied',
    permission_state_change: permissionStateChange,
  };
}

function rejected(
  reason: ApprovalDecisionRejectionReason,
  message: string,
): ValidateApprovalDecisionResult {
  return {
    status: 'rejected',
    reason,
    message,
  };
}
