/* Persists Permission-owned rules without interpreting their safety semantics. */
import { z } from 'zod';
import {
  PermissionModeSchema,
  PermissionRuleSchema,
  PermissionSettingsSchema,
  type PermissionRule,
  type PermissionSettings,
} from '@megumi/permissions';
import type {
  SettingsFailureResult,
  SettingsRaw,
  SettingsResolved,
} from './settings-schema';

export { PermissionRuleSchema, PermissionSettingsSchema };
export type { PermissionRule, PermissionSettings };

export const PermissionRulesRawSchema = z.object({
  mode: PermissionModeSchema.optional(),
  allow: z.array(PermissionRuleSchema).optional(),
  ask: z.array(PermissionRuleSchema).optional(),
  deny: z.array(PermissionRuleSchema).optional(),
}).strict();
export type PermissionRulesRaw = z.infer<typeof PermissionRulesRawSchema>;

export const ResolvePermissionSettingsRequestSchema = z.object({
  user_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
}).strict();
export type ResolvePermissionSettingsRequest = z.infer<typeof ResolvePermissionSettingsRequestSchema>;

export const RecordSessionPermissionGrantRequestSchema = z.object({
  rules: z.array(PermissionRuleSchema).min(1),
  session_id: z.string().min(1),
  applied_at: z.string().min(1).optional(),
}).strict();
export type RecordSessionPermissionGrantRequest = z.infer<typeof RecordSessionPermissionGrantRequestSchema>;

export const PermissionRuleEffectSchema = z.enum(['allow', 'ask', 'deny']);
export type PermissionRuleEffect = z.infer<typeof PermissionRuleEffectSchema>;
export const ChangePermissionRulesRequestSchema = z.object({
  operation: z.enum(['add', 'remove']),
  effect: PermissionRuleEffectSchema,
  rules: z.array(PermissionRuleSchema).min(1),
  workspace_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
}).strict();
export type ChangePermissionRulesRequest = z.infer<typeof ChangePermissionRulesRequestSchema>;

export type AddPermissionRulesResult =
  | { status: 'saved'; settings: SettingsResolved }
  | SettingsFailureResult;
export type ChangePermissionRulesResult = AddPermissionRulesResult;

export function resolvePermissionSettings(
  settings: PermissionSettings,
  request: ResolvePermissionSettingsRequest,
): PermissionSettings {
  return PermissionSettingsSchema.parse({
    mode: settings.mode,
    allow: filterRules(settings.allow, request),
    ask: filterRules(settings.ask, request),
    deny: filterRules(settings.deny, request),
  });
}

export function addPermissionRulesPatch(
  current: SettingsRaw,
  request: RecordSessionPermissionGrantRequest,
): { status: 'patch'; patch: SettingsRaw } | { status: 'error'; settingsCode: string; message: string } {
  if (request.rules.some((rule) => rule.source !== 'session')) {
    return domainError('permission_rule_source_unsupported', 'Only session permission rule writes are supported.');
  }
  if (request.rules.some((rule) => rule.source_id !== request.session_id)) {
    return domainError('permission_session_mismatch', 'Session permission rule source_id must match request session_id.');
  }
  return changePermissionRulesPatch(current, {
    operation: 'add',
    effect: 'allow',
    rules: request.rules,
    session_id: request.session_id,
  });
}

export function changePermissionRulesPatch(
  current: SettingsRaw,
  request: ChangePermissionRulesRequest,
): { status: 'patch'; patch: SettingsRaw } | { status: 'error'; settingsCode: string; message: string } {
  for (const rule of request.rules) {
    if (rule.source === 'workspace' && rule.source_id !== request.workspace_id) {
      return domainError('permission_workspace_mismatch', 'Workspace permission rule source_id must match request workspace_id.');
    }
    if (rule.source === 'session' && rule.source_id !== request.session_id) {
      return domainError('permission_session_mismatch', 'Session permission rule source_id must match request session_id.');
    }
  }
  const existing = current.permissions?.[request.effect] ?? [];
  const next = request.operation === 'add'
    ? request.rules.reduce<typeof existing>((rules, candidate) => {
        if (!rules.some((rule) => structurallyEqual(rule, candidate))) rules.push(candidate);
        return rules;
      }, [...existing])
    : existing.filter((candidate) => !request.rules.some((rule) => structurallyEqual(rule, candidate)));
  if (structurallyEqual(existing, next)) return { status: 'patch', patch: {} };
  return { status: 'patch', patch: { permissions: { [request.effect]: next } } };
}

function filterRules(
  rules: PermissionRule[],
  request: ResolvePermissionSettingsRequest,
): PermissionRule[] {
  return rules.filter((rule) => {
    if (rule.source === 'user') return true;
    if (rule.source === 'workspace') return Boolean(request.workspace_id && rule.source_id === request.workspace_id);
    return Boolean(request.session_id && rule.source_id === request.session_id);
  });
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function domainError(settingsCode: string, message: string) {
  return { status: 'error' as const, settingsCode, message };
}
