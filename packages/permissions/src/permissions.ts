/*
 * Provides the single Permissions capability entry without owning Engine lifecycle or Tool execution.
 */
import { z } from 'zod';
import {
  ApplyApprovalDecisionRequestSchema,
  ApplyApprovalDecisionResultSchema,
  PermissionDecisionSchema,
  ApprovalSubjectSchema,
  resolveApprovalEffect,
  type ApplyApprovalDecisionRequest,
  type ApplyApprovalDecisionResult,
  type ApprovalSubject,
  type PermissionDecision,
} from './approval';
import {
  EvaluateToolCallRequestSchema,
  PermissionOperationSchema,
  resolvePermissionOperations,
  resolveWorkspacePathTargets,
  type EvaluateToolCallRequest,
  type PermissionOperation,
  type PermissionWorkspacePathClassifier,
} from './permission-operation';
import { evaluatePermissionPolicy } from './permission-policy';
import { ToolExecutionAccessSchema } from './permission-execution-access';
import {
  PermissionFailureSchema,
  type PermissionFailure,
  type PermissionRuleReader,
  type PermissionRuleWriter,
} from './permission-rules';

export const EvaluateToolCallResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    operations: z.array(PermissionOperationSchema).min(1),
    decision: PermissionDecisionSchema,
    approvalSubject: ApprovalSubjectSchema,
    executionAccess: ToolExecutionAccessSchema.optional(),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: PermissionFailureSchema }).strict(),
]);

export type EvaluateToolCallResult =
  | {
      readonly status: 'ok';
      readonly operations: readonly PermissionOperation[];
      readonly decision: PermissionDecision;
      readonly approvalSubject: ApprovalSubject;
      readonly executionAccess?: import('@megumi/sandbox').ToolExecutionAccess;
    }
  | { readonly status: 'failed'; readonly failure: PermissionFailure };

export interface Permissions {
  evaluateToolCall(request: EvaluateToolCallRequest): Promise<EvaluateToolCallResult>;
  applyApprovalDecision(request: ApplyApprovalDecisionRequest): Promise<ApplyApprovalDecisionResult>;
}

export interface CreatePermissionsRequest {
  readonly ruleReader: PermissionRuleReader;
  readonly ruleWriter: PermissionRuleWriter;
  readonly workspacePathClassifier: PermissionWorkspacePathClassifier;
}

export function createPermissions(dependencies: CreatePermissionsRequest): Permissions {
  return {
    async evaluateToolCall(request) {
      const parsed = EvaluateToolCallRequestSchema.safeParse(request);
      if (!parsed.success) {
        return invalidRequestFailure('permission_request_invalid', 'Permission request is invalid.', parsed.error);
      }

      let rules: Awaited<ReturnType<PermissionRuleReader['resolvePermissionRules']>>;
      try {
        rules = await dependencies.ruleReader.resolvePermissionRules({
          workspaceId: parsed.data.workspaceId,
          sessionId: parsed.data.sessionId,
        });
      } catch {
        return dependencyFailure(
          'permission_rules_failed',
          'Permission rules could not be resolved.',
          'permission_rules_resolution_threw',
        );
      }
      if (rules.status === 'failed') {
        return dependencyFailure(
          'permission_rules_failed',
          'Permission rules could not be resolved.',
          rules.failure.code,
        );
      }

      const pathTargets = resolveWorkspacePathTargets(parsed.data);
      const workspacePaths: Record<string, Awaited<ReturnType<PermissionWorkspacePathClassifier['classifyWorkspacePath']>>> = {};
      try {
        for (const target of pathTargets) {
          workspacePaths[target.key] = await dependencies.workspacePathClassifier.classifyWorkspacePath({
            workspaceId: parsed.data.workspaceId,
            targetPath: target.path,
          });
        }
      } catch {
        return dependencyFailure(
          'permission_workspace_path_failed',
          'Workspace path could not be classified.',
          'workspace_path_classification_threw',
        );
      }
      const failedPath = Object.values(workspacePaths).find((result) => result.status === 'failed');
      if (failedPath?.status === 'failed') {
        return dependencyFailure(
          'permission_workspace_path_failed',
          'Workspace path could not be classified.',
          failedPath.failure.code,
        );
      }

      const resolved = resolvePermissionOperations({
        evaluation: parsed.data,
        workspacePaths: Object.fromEntries(Object.entries(workspacePaths).flatMap(([field, result]) => (
          result.status === 'classified' ? [[field, result.workspacePath]] : []
        ))),
      });
      const policy = evaluatePermissionPolicy({
        evaluation: parsed.data,
        operations: resolved.operations,
        criticalInput: resolved.criticalInput,
        riskFacts: resolved.riskFacts,
        permissionSettings: rules.permissionSettings,
      });
      return {
        status: 'ok',
        operations: resolved.operations,
        decision: policy.decision,
        approvalSubject: policy.approvalSubject,
        ...(policy.executionAccess ? { executionAccess: policy.executionAccess } : {}),
      };
    },

    async applyApprovalDecision(request) {
      const parsed = ApplyApprovalDecisionRequestSchema.safeParse(request);
      if (!parsed.success) {
        return invalidApprovalRequest(parsed.error);
      }
      const result = resolveApprovalEffect(parsed.data);
      if (result.status !== 'applied' || result.effect.type !== 'session_tool_grant') {
        return result;
      }
      try {
        const saved = await dependencies.ruleWriter.addPermissionRules({
          sessionId: parsed.data.sessionId,
          rules: [result.effect.rule],
          appliedAt: parsed.data.appliedAt,
        });
        return saved.status === 'saved'
          ? result
          : { status: 'failed', failure: sanitizeDependencyFailure(saved.failure) };
      } catch {
        return {
          status: 'failed',
          failure: {
            code: 'permission_rules_write_failed',
            message: 'Permission rules could not be saved.',
          },
        };
      }
    },
  };
}

function invalidRequestFailure(
  code: string,
  message: string,
  error: z.ZodError,
): EvaluateToolCallResult {
  return {
    status: 'failed',
    failure: {
      code,
      message,
      details: {
        issues: error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map(String),
          message: issue.message,
        })),
      },
    },
  };
}

function dependencyFailure(
  code: string,
  message: string,
  dependencyCode: string,
): EvaluateToolCallResult {
  return {
    status: 'failed',
    failure: { code, message, details: { dependencyCode } },
  };
}

function invalidApprovalRequest(error: z.ZodError): ApplyApprovalDecisionResult {
  return {
    status: 'failed',
    failure: {
      code: 'approval_request_invalid',
      message: 'Approval request is invalid.',
      details: {
        issues: error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map(String),
          message: issue.message,
        })),
      },
    },
  };
}

function sanitizeDependencyFailure(failure: PermissionFailure): PermissionFailure {
  return {
    code: 'permission_rules_write_failed',
    message: 'Permission rules could not be saved.',
    details: { dependencyCode: failure.code },
  };
}

export { ApplyApprovalDecisionResultSchema };
