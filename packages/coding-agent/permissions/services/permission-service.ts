/*
 * Public Permission Service entry point.
 * It delegates pure policy decisions to core and writes session rules through injected Settings.
 */
import type {
  ApplyApprovalDecisionRequest,
  ApplyApprovalDecisionResult,
  PermissionSettingsApplyService,
  ValidateApprovalDecisionRequest,
  ValidateApprovalDecisionResult,
} from '../contracts/approval-policy-contracts';
import type {
  EvaluateToolExecutionRequest,
  EvaluateToolExecutionResult,
} from '../contracts/permission-contracts';
import { calculateApprovalStateChange, validateApprovalDecision as validateApprovalDecisionPolicy } from '../core/approval-policy';
import { evaluateToolExecution as evaluateToolExecutionPolicy } from '../core/permission-policy';

export type PermissionService = {
  evaluateToolExecution(
    request: EvaluateToolExecutionRequest,
  ): EvaluateToolExecutionResult;
  validateApprovalDecision(
    request: ValidateApprovalDecisionRequest,
  ): Promise<ValidateApprovalDecisionResult> | ValidateApprovalDecisionResult;
  applyApprovalDecision(request: ApplyApprovalDecisionRequest): Promise<ApplyApprovalDecisionResult>;
};

export type CreatePermissionServiceOptions = {
  settings_service: PermissionSettingsApplyService;
};

export function createPermissionService(options: CreatePermissionServiceOptions): PermissionService {
  return {
    evaluateToolExecution(request) {
      return evaluateToolExecutionPolicy(request);
    },

    validateApprovalDecision(request) {
      return validateApprovalDecisionPolicy(request);
    },

    async applyApprovalDecision(request) {
      const result = calculateApprovalStateChange(request);
      if (result.status === 'failed' || result.permission_state_change.type !== 'settings_rule_change') {
        return result;
      }

      const settingsResult = await options.settings_service.addPermissionRule({
        rule: result.permission_state_change.rule,
        session_id: request.session_id,
        applied_at: request.applied_at,
      });
      if (settingsResult.status === 'failed') {
        return {
          status: 'failed',
          failure: settingsResult.failure,
        };
      }

      return result;
    },
  };
}
