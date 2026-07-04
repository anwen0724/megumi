/*
 * Public contracts for Permissions approval decision policy.
 * Agent Run owns approval lifecycle; Permissions owns decision validation and state changes.
 */
import { z } from 'zod';
import {
  PermissionDecisionSchema,
  PermissionRuleSchema,
  RuntimeErrorSchema,
  type PermissionRule,
  type RuntimeError,
} from './permission-contracts';

export const ApprovalScopeSchema = z.enum(['once', 'session']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalDecisionSchema = z
  .object({
    approval_request_id: z.string().min(1),
    decision: z.enum(['approved', 'denied']),
    scope: ApprovalScopeSchema,
    decided_by: z.enum(['user', 'host', 'system']),
    reason: z.string().min(1).optional(),
    decided_at: z.string().min(1),
  })
  .strict();
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const PermissionStateChangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('none'),
    })
    .strict(),
  z
    .object({
      type: z.literal('settings_rule_change'),
      rule: PermissionRuleSchema,
    })
    .strict(),
]);
export type PermissionStateChange = z.infer<typeof PermissionStateChangeSchema>;

export const ApprovalRequestFactsSchema = z
  .object({
    approval_request_id: z.string().min(1),
    status: z.enum(['pending', 'approved', 'denied', 'cancelled']),
    subject: z
      .object({
        type: z.literal('tool_call'),
        tool_call_id: z.string().min(1),
        tool_name: z.string().min(1),
        input: z.unknown(),
      })
      .strict(),
    allowed_scopes: z.array(ApprovalScopeSchema).min(1),
  })
  .strict();
export type ApprovalRequestFacts = z.infer<typeof ApprovalRequestFactsSchema>;

export const ApprovalDecisionRejectionReasonSchema = z.enum([
  'approval_request_not_pending',
  'run_not_waiting_for_approval',
  'approval_subject_mismatch',
  'decision_not_allowed',
  'approval_scope_not_allowed',
  'expired',
]);
export type ApprovalDecisionRejectionReason = z.infer<typeof ApprovalDecisionRejectionReasonSchema>;

export const ValidateApprovalDecisionRequestSchema = z
  .object({
    approval_request: ApprovalRequestFactsSchema,
    original_permission_decision: PermissionDecisionSchema,
    decision: ApprovalDecisionSchema,
    current_run_status: z.enum(['waiting_for_approval', 'running', 'completed', 'failed', 'cancelled']),
    validated_at: z.string().min(1),
  })
  .strict();
export type ValidateApprovalDecisionRequest = z.infer<typeof ValidateApprovalDecisionRequestSchema>;

export const ValidateApprovalDecisionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('accepted'),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      reason: ApprovalDecisionRejectionReasonSchema,
      message: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      failure: RuntimeErrorSchema,
    })
    .strict(),
]);
export type ValidateApprovalDecisionResult = z.infer<typeof ValidateApprovalDecisionResultSchema>;

export const ApplyApprovalDecisionRequestSchema = z
  .object({
    session_id: z.string().min(1),
    approval_request: ApprovalRequestFactsSchema,
    original_permission_decision: PermissionDecisionSchema,
    decision: ApprovalDecisionSchema,
    applied_at: z.string().min(1),
  })
  .strict();
export type ApplyApprovalDecisionRequest = z.infer<typeof ApplyApprovalDecisionRequestSchema>;

export const ApplyApprovalDecisionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('applied'),
      permission_state_change: PermissionStateChangeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      failure: RuntimeErrorSchema,
    })
    .strict(),
]);
export type ApplyApprovalDecisionResult = z.infer<typeof ApplyApprovalDecisionResultSchema>;

export type PermissionSettingsApplyService = {
  addPermissionRule(request: {
    rule: PermissionRule;
    session_id: string;
    applied_at: string;
  }): Promise<
    | { status: 'saved' }
    | { status: 'failed'; failure: RuntimeError }
  > | (
    | { status: 'saved' }
    | { status: 'failed'; failure: RuntimeError }
  );
};
