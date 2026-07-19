/* Applies only effects precomputed in an immutable Permission Decision. */
import type { ApplyApprovalDecisionRequest, ApplyApprovalDecisionResult } from '../contracts/approval-policy-contracts';

export function resolveApprovalEffect(request: ApplyApprovalDecisionRequest): ApplyApprovalDecisionResult {
  if (request.original_permission_decision.type !== 'requires_approval') {
    return { status: 'rejected', reason: 'decision_not_allowed', message: 'This permission decision cannot be approved.' };
  }
  if (request.decision.decision === 'denied') return { status: 'applied', effect: { type: 'none' } };
  const optionId = request.decision.option_id;
  const option = request.original_permission_decision.options.find((item) => item.option_id === optionId);
  if (!option) return { status: 'rejected', reason: 'option_not_found', message: 'Approval option was not found.' };
  if (option.effect.type === 'current_tool_call') return { status: 'applied', effect: { type: 'none' } };
  if (option.effect.rule.source !== 'session' || option.effect.rule.source_id !== request.session_id) {
    return { status: 'rejected', reason: 'session_mismatch', message: 'Approval option does not belong to this session.' };
  }
  return { status: 'applied', effect: { type: 'session_tool_grant', rule: option.effect.rule } };
}
