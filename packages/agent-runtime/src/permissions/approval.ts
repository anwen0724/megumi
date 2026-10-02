/*
 * Defines immutable Approval subjects, user decisions, effects, and application validation.
 */
import { z } from 'zod';
import type { JsonObject, JsonValue } from './json';
import {
  JsonValueSchema,
  PermissionFailureSchema,
  PermissionModeSchema,
  PermissionRuleSchema,
  SafetyAssessmentSchema,
  type PermissionFailure,
  type PermissionRule,
  type SafetyAssessment,
} from './permission-rules';
import {
  PermissionOperationSchema,
  PermissionToolIdentitySchema,
  type PermissionOperation,
  type PermissionToolIdentity,
} from './permission-operation';
import { executionAccessFor, ToolExecutionAccessSchema } from './permission-execution-access';

export const PermissionDenialCodeSchema = z.enum(['rule_denied', 'policy_denied']);
export type PermissionDenialCode = z.infer<typeof PermissionDenialCodeSchema>;

export const ApprovalScopeSchema = z.enum(['once', 'session']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalOptionSchema = z.object({
  optionId: z.string().min(1),
  scope: ApprovalScopeSchema,
  display: z.object({
    label: z.string().min(1),
    description: z.string().min(1),
  }).strict(),
  effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('current_tool_call') }).strict(),
    z.object({
      type: z.literal('session_tool_grant'),
      rule: PermissionRuleSchema,
    }).strict(),
  ]),
}).strict();
export type ApprovalOption = z.infer<typeof ApprovalOptionSchema>;

const PermissionDecisionBaseSchema = z.object({
  operations: z.array(PermissionOperationSchema).min(1),
  safetyAssessment: SafetyAssessmentSchema,
  safetySummary: z.string().min(1),
  reason: z.string().min(1),
});

export const PermissionDecisionSchema = z.discriminatedUnion('type', [
  PermissionDecisionBaseSchema.extend({ type: z.literal('allow') }).strict(),
  PermissionDecisionBaseSchema.extend({
    type: z.literal('deny'),
    denialCode: PermissionDenialCodeSchema,
  }).strict(),
  PermissionDecisionBaseSchema.extend({
    type: z.literal('requires_approval'),
    options: z.array(ApprovalOptionSchema).min(1).max(2),
    defaultOptionId: z.string().min(1),
    subjectFingerprint: z.string().min(1),
  }).strict(),
]).superRefine((decision, context) => {
  if (decision.type !== 'requires_approval') return;
  if (!decision.options.some((option) => option.optionId === decision.defaultOptionId)) {
    context.addIssue({
      code: 'custom', path: ['defaultOptionId'], message: 'Default Approval option must exist.',
    });
  }
  const once = decision.options.filter((option) => option.scope === 'once');
  const session = decision.options.filter((option) => option.scope === 'session');
  if (once.length !== 1 || session.length > 1 || once[0]?.optionId !== decision.defaultOptionId) {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Approval options require one default once option and at most one session option.',
    });
  }
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const ApprovalSubjectSchema = z.object({
  version: z.literal(1),
  toolCallId: z.string().min(1),
  toolIdentity: PermissionToolIdentitySchema,
  criticalInput: JsonValueSchema,
  operations: z.array(PermissionOperationSchema).min(1),
  safetyAssessment: SafetyAssessmentSchema,
  riskFacts: z.record(z.string(), JsonValueSchema),
  fingerprint: z.string().min(1),
}).strict();
export type ApprovalSubject = z.infer<typeof ApprovalSubjectSchema>;

const ApprovalDecisionBaseSchema = z.object({
  approvalRequestId: z.string().min(1),
  decidedBy: z.enum(['user', 'host', 'system']),
  reason: z.string().min(1).optional(),
  decidedAt: z.string().min(1),
});

export const ApprovalDecisionSchema = z.discriminatedUnion('decision', [
  ApprovalDecisionBaseSchema.extend({
    decision: z.literal('approved'),
    optionId: z.string().min(1),
  }).strict(),
  ApprovalDecisionBaseSchema.extend({ decision: z.literal('denied') }).strict(),
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApplyApprovalDecisionRequestSchema = z.object({
  originalPermissionDecision: PermissionDecisionSchema,
  originalSubject: ApprovalSubjectSchema,
  currentSubject: ApprovalSubjectSchema,
  decision: ApprovalDecisionSchema,
  sessionId: z.string().min(1),
  appliedAt: z.string().min(1),
  permissionMode: PermissionModeSchema,
}).strict();
export type ApplyApprovalDecisionRequest = z.infer<typeof ApplyApprovalDecisionRequestSchema>;

export const ApprovalEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({
    type: z.literal('session_tool_grant'),
    rule: PermissionRuleSchema,
  }).strict(),
]);
export type ApprovalEffect = z.infer<typeof ApprovalEffectSchema>;

export const ApplyApprovalDecisionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('applied'),
    effect: ApprovalEffectSchema,
    executionAccess: ToolExecutionAccessSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    reason: z.enum([
      'option_not_found',
      'decision_not_allowed',
      'session_mismatch',
      'subject_invalid',
      'subject_changed',
    ]),
    message: z.string().min(1),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: PermissionFailureSchema }).strict(),
]);
export type ApplyApprovalDecisionResult = z.infer<typeof ApplyApprovalDecisionResultSchema>;

export function createApprovalSubject(request: {
  readonly toolCallId: string;
  readonly toolIdentity: PermissionToolIdentity;
  readonly criticalInput: JsonValue;
  readonly operations: readonly PermissionOperation[];
  readonly safetyAssessment: SafetyAssessment;
  readonly riskFacts: JsonObject;
}): ApprovalSubject {
  const content = {
    version: 1 as const,
    toolCallId: request.toolCallId,
    toolIdentity: request.toolIdentity,
    criticalInput: request.criticalInput,
    operations: [...request.operations],
    safetyAssessment: request.safetyAssessment,
    riskFacts: request.riskFacts,
  };
  return deepFreeze({
    ...content,
    fingerprint: fingerprintSubjectContent(content),
  });
}

export function resolveApprovalEffect(
  request: ApplyApprovalDecisionRequest,
): ApplyApprovalDecisionResult {
  if (request.originalPermissionDecision.type !== 'requires_approval') {
    return rejected('decision_not_allowed', 'This Permission decision cannot be approved.');
  }
  if (!isValidApprovalSubject(request.originalSubject)
    || request.originalPermissionDecision.subjectFingerprint !== request.originalSubject.fingerprint
    || stableSerialize(request.originalPermissionDecision.operations)
      !== stableSerialize(request.originalSubject.operations)) {
    return rejected('subject_invalid', 'The original Approval subject is invalid.');
  }
  if (!isValidApprovalSubject(request.currentSubject)) {
    return rejected('subject_invalid', 'The current Approval subject is invalid.');
  }
  if (request.originalSubject.fingerprint !== request.currentSubject.fingerprint
    || stableSerialize(request.originalSubject) !== stableSerialize(request.currentSubject)) {
    return rejected('subject_changed', 'The Tool Call changed after Approval was requested.');
  }
  const approvalDecision = request.decision;
  if (approvalDecision.decision === 'denied') {
    return { status: 'applied', effect: { type: 'none' } };
  }
  const option = request.originalPermissionDecision.options.find(
    (candidate) => candidate.optionId === approvalDecision.optionId,
  );
  if (!option) return rejected('option_not_found', 'Approval option was not found.');
  const executionAccess = executionAccessFor({
    permissionMode: request.permissionMode,
    operations: request.currentSubject.operations,
    approved: true,
  });
  if (option.effect.type === 'current_tool_call') {
    return { status: 'applied', effect: { type: 'none' }, executionAccess };
  }
  if (option.effect.rule.source !== 'session'
    || option.effect.rule.source_id !== request.sessionId) {
    return rejected('session_mismatch', 'Approval option does not belong to this Session.');
  }
  return {
    status: 'applied',
    effect: { type: 'session_tool_grant', rule: option.effect.rule },
    executionAccess,
  };
}

function isValidApprovalSubject(subject: ApprovalSubject): boolean {
  const parsed = ApprovalSubjectSchema.safeParse(subject);
  if (!parsed.success) return false;
  const { fingerprint: _fingerprint, ...content } = parsed.data;
  return subject.fingerprint === fingerprintSubjectContent(content);
}

function fingerprintSubjectContent(content: Omit<ApprovalSubject, 'fingerprint'>): string {
  const serialized = stableSerialize(content);
  // Fingerprints are change detectors, not authorization secrets. Full subject
  // equality is also checked so hash collisions cannot reuse an Approval.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b);
  }
  return `permission-subject:v1:${unsignedHex(left)}${unsignedHex(right)}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function rejected(
  reason: Extract<ApplyApprovalDecisionResult, { status: 'rejected' }>['reason'],
  message: string,
): ApplyApprovalDecisionResult {
  return { status: 'rejected', reason, message };
}

export type { PermissionFailure, PermissionRule };
