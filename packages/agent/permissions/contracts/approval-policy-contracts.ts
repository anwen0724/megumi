/* Defines immutable Approval Option application contracts for Permissions. */
import { z } from 'zod';
import { PermissionDecisionSchema, PermissionRuleSchema, RuntimeErrorSchema, type PermissionRule, type RuntimeError } from './permission-contracts';

export const ApprovalScopeSchema = z.enum(['once', 'session']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;
const ApprovalDecisionBaseSchema = z.object({
  approval_request_id: z.string().min(1), decided_by: z.enum(['user', 'host', 'system']),
  reason: z.string().min(1).optional(), decided_at: z.string().min(1),
});
export const ApprovalDecisionSchema = z.discriminatedUnion('decision', [
  ApprovalDecisionBaseSchema.extend({ decision: z.literal('approved'), option_id: z.string().min(1) }).strict(),
  ApprovalDecisionBaseSchema.extend({ decision: z.literal('denied') }).strict(),
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApplyApprovalDecisionRequestSchema = z.object({
  original_permission_decision: PermissionDecisionSchema, decision: ApprovalDecisionSchema,
  session_id: z.string().min(1), applied_at: z.string().min(1),
}).strict();
export type ApplyApprovalDecisionRequest = z.infer<typeof ApplyApprovalDecisionRequestSchema>;

export const ApplyApprovalDecisionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }).strict(),
    z.object({ type: z.literal('session_tool_grant'), rule: PermissionRuleSchema }).strict(),
  ]) }).strict(),
  z.object({ status: z.literal('rejected'), reason: z.enum(['option_not_found', 'decision_not_allowed', 'session_mismatch']), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: RuntimeErrorSchema }).strict(),
]);
export type ApplyApprovalDecisionResult = z.infer<typeof ApplyApprovalDecisionResultSchema>;

export type PermissionSettingsApplyService = {
  addPermissionRules(request: { session_id: string; rules: PermissionRule[]; applied_at: string }): Promise<
    { status: 'saved' } | { status: 'failed'; failure: RuntimeError }
  >;
};
