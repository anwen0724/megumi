/*
 * Filters Settings-owned permission rules and creates atomic sparse patches.
 * This module deliberately does not evaluate whether any action is safe.
 */
import {
  AddPermissionRulesRequestSchema,
  ChangePermissionRulesRequestSchema,
  PermissionRuleSchema,
  type AddPermissionRulesRequest,
  type AddPermissionRulesResult,
  type ChangePermissionRulesRequest,
  type ChangePermissionRulesResult,
  type ResolvePermissionSettingsRequest,
  type ResolvePermissionSettingsResult,
} from '../contracts/permission-settings-contracts';
import type { SettingsRaw, SettingsResolved } from '../contracts/settings-contracts';

export function resolvePermissionSettingsFromResolvedSettings(
  settings: SettingsResolved,
  request: ResolvePermissionSettingsRequest,
): ResolvePermissionSettingsResult {
  return {
    status: 'ok',
    permission_settings: {
      mode: settings.permissions.mode,
      allow: filterRules(settings.permissions.allow, request),
      ask: filterRules(settings.permissions.ask, request),
      deny: filterRules(settings.permissions.deny, request),
    },
  };
}

export function addPermissionRulesToRawSettings(
  current: SettingsRaw,
  request: AddPermissionRulesRequest,
): AddPermissionRulesResult | { status: 'patch'; patch: SettingsRaw } {
  const parsed = AddPermissionRulesRequestSchema.safeParse(request);
  if (!parsed.success) {
    return failure('permission_rules_invalid', 'Permission rules are invalid.', { issues: parsed.error.issues });
  }

  if (parsed.data.rules.some((rule) => rule.source !== 'session')) {
    return failure('permission_rule_source_unsupported', 'Only session permission rule writes are supported.');
  }
  if (parsed.data.rules.some((rule) => rule.source_id !== parsed.data.session_id)) {
    return failure('permission_session_mismatch', 'Session permission rule source_id must match request session_id.');
  }

  return changePermissionRulesInRawSettings(current, {
    operation: 'add', effect: 'allow', rules: parsed.data.rules, session_id: parsed.data.session_id,
  });
}

export function changePermissionRulesInRawSettings(
  current: SettingsRaw,
  request: ChangePermissionRulesRequest,
): ChangePermissionRulesResult | { status: 'patch'; patch: SettingsRaw } {
  const parsed = ChangePermissionRulesRequestSchema.safeParse(request);
  if (!parsed.success) return failure('permission_rules_invalid', 'Permission rules are invalid.', { issues: parsed.error.issues });
  for (const rule of parsed.data.rules) {
    if (rule.source === 'workspace' && rule.source_id !== parsed.data.workspace_id) {
      return failure('permission_workspace_mismatch', 'Workspace permission rule source_id must match request workspace_id.');
    }
    if (rule.source === 'session' && rule.source_id !== parsed.data.session_id) {
      return failure('permission_session_mismatch', 'Session permission rule source_id must match request session_id.');
    }
  }
  const existing = current.permissions?.[parsed.data.effect] ?? [];
  const next = parsed.data.operation === 'add'
    ? parsed.data.rules.reduce<typeof existing>((rules, candidate) => {
        if (!rules.some((rule) => structurallyEqual(rule, candidate))) rules.push(candidate);
        return rules;
      }, [...existing])
    : existing.filter((candidate) => !parsed.data.rules.some((rule) => structurallyEqual(rule, candidate)));
  if (structurallyEqual(existing, next)) return { status: 'patch', patch: {} };
  return { status: 'patch', patch: { permissions: { [parsed.data.effect]: next } } };
}

function filterRules(
  rules: Array<ReturnType<typeof PermissionRuleSchema.parse>>,
  request: ResolvePermissionSettingsRequest,
) {
  return rules.filter((rule) => {
    if (rule.source === 'user') return true;
    if (rule.source === 'workspace') return Boolean(request.workspace_id && rule.source_id === request.workspace_id);
    return Boolean(request.session_id && rule.source_id === request.session_id);
  });
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failure(code: string, message: string, details?: Record<string, unknown>): AddPermissionRulesResult {
  return { status: 'failed', failure: { code, message, ...(details ? { details } : {}) } };
}
