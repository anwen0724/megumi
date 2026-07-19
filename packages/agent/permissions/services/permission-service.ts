/* Coordinates pure Permission policy and Settings-owned rule persistence. */
import { ApplyApprovalDecisionRequestSchema, type ApplyApprovalDecisionRequest, type ApplyApprovalDecisionResult, type PermissionSettingsApplyService } from '../contracts/approval-policy-contracts';
import { EvaluateToolCallRequestSchema, type EvaluateToolCallRequest, type EvaluateToolCallResult } from '../contracts/permission-contracts';
import { resolveApprovalEffect } from '../core/approval-policy';
import { evaluateToolCall } from '../core/permission-policy';

export type PermissionService = {
  evaluateToolCall(request: EvaluateToolCallRequest): Promise<EvaluateToolCallResult> | EvaluateToolCallResult;
  applyApprovalDecision(request: ApplyApprovalDecisionRequest): Promise<ApplyApprovalDecisionResult>;
};
export function createPermissionService(options: {
  settings_service: PermissionSettingsApplyService;
}): PermissionService {
  return {
    evaluateToolCall(request) {
      const parsed = EvaluateToolCallRequestSchema.safeParse(request);
      return parsed.success
        ? evaluateToolCall(parsed.data)
        : { status: 'failed', failure: { code: 'permission_request_invalid', message: 'Permission request is invalid.', details: { issues: parsed.error.issues } } };
    },
    async applyApprovalDecision(request) {
      const parsed = ApplyApprovalDecisionRequestSchema.safeParse(request);
      if (!parsed.success) return { status: 'failed', failure: { code: 'approval_request_invalid', message: 'Approval request is invalid.', details: { issues: parsed.error.issues } } };
      const result = resolveApprovalEffect(parsed.data);
      if (result.status !== 'applied' || result.effect.type !== 'session_tool_grant') return result;
      const saved = await options.settings_service.addPermissionRules({
        session_id: parsed.data.session_id, rules: [result.effect.rule], applied_at: parsed.data.applied_at,
      });
      return saved.status === 'saved' ? result : { status: 'failed', failure: saved.failure };
    },
  };
}
