/* Coordinates pure Permission policy and Settings-owned rule persistence. */
import {
  ApplyApprovalDecisionRequestSchema,
  type ApplyApprovalDecisionRequest,
  type ApplyApprovalDecisionResult,
  type PermissionSettingsService,
  type PermissionWorkspacePathPolicy,
} from '../contracts/approval-policy-contracts';
import { EvaluateToolCallRequestSchema, type EvaluateToolCallRequest, type EvaluateToolCallResult } from '../contracts/permission-contracts';
import { resolveApprovalEffect } from '../core/approval-policy';
import { resolveWorkspacePathTarget } from '../core/operation-resolver';
import { evaluateToolCall } from '../core/permission-policy';

export type PermissionService = {
  evaluateToolCall(request: EvaluateToolCallRequest): Promise<EvaluateToolCallResult>;
  applyApprovalDecision(request: ApplyApprovalDecisionRequest): Promise<ApplyApprovalDecisionResult>;
};
export function createPermissionService(options: {
  settings_service: PermissionSettingsService;
  workspace_path_policy: PermissionWorkspacePathPolicy;
}): PermissionService {
  return {
    async evaluateToolCall(request) {
      const parsed = EvaluateToolCallRequestSchema.safeParse(request);
      if (!parsed.success) {
        return {
          status: 'failed',
          failure: {
            code: 'permission_request_invalid',
            message: 'Permission request is invalid.',
            details: { issues: parsed.error.issues },
          },
        };
      }
      let resolved: Awaited<ReturnType<PermissionSettingsService['resolvePermissionSettings']>>;
      try {
        resolved = await options.settings_service.resolvePermissionSettings({
          workspace_id: parsed.data.workspace_id,
          session_id: parsed.data.session_id,
        });
      } catch {
        return permissionSettingsFailure('settings_resolution_threw');
      }
      if (resolved.status === 'failed') {
        return permissionSettingsFailure(resolved.failure.code);
      }

      const targetPath = resolveWorkspacePathTarget(parsed.data);
      let classified:
        | Awaited<ReturnType<PermissionWorkspacePathPolicy['classifyPath']>>
        | undefined;
      try {
        classified = targetPath
          ? await options.workspace_path_policy.classifyPath({
              workspace_id: parsed.data.workspace_id,
              target_path: targetPath,
            })
          : undefined;
      } catch {
        return workspacePathFailure('workspace_path_classification_threw');
      }
      if (classified?.status === 'failed') {
        return workspacePathFailure(classified.failure.code);
      }
      return evaluateToolCall({
        ...parsed.data,
        ...(classified?.status === 'classified'
          ? { workspace_path: classified.workspace_path }
          : {}),
        permission_settings: {
          ...resolved.permission_settings,
          mode: parsed.data.permission_mode,
        },
      });
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

function permissionSettingsFailure(settingsFailureCode: string): EvaluateToolCallResult {
  return {
    status: 'failed',
    failure: {
      code: 'permission_settings_failed',
      message: 'Permission settings could not be resolved.',
      details: { settings_failure_code: settingsFailureCode },
    },
  };
}

function workspacePathFailure(workspaceFailureCode: string): EvaluateToolCallResult {
  return {
    status: 'failed',
    failure: {
      code: 'permission_workspace_path_failed',
      message: 'Workspace path could not be classified.',
      details: { workspace_failure_code: workspaceFailureCode },
    },
  };
}
