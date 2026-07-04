/*
 * Filters Settings-owned permission rules and creates sparse raw patches for rule writes.
 * This file does not evaluate whether a tool call is allowed.
 */
import {
  AddPermissionRuleRequestSchema,
  PermissionRuleSchema,
  type AddPermissionRuleRequest,
  type AddPermissionRuleResult,
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
      allow: filterRules(settings.permissions.allow, request),
      ask: filterRules(settings.permissions.ask, request),
      deny: filterRules(settings.permissions.deny, request),
    },
  };
}

export function addPermissionRuleToRawSettings(
  current: SettingsRaw,
  request: AddPermissionRuleRequest,
): AddPermissionRuleResult | { status: 'patch'; patch: SettingsRaw } {
  const parsed = AddPermissionRuleRequestSchema.safeParse(request);
  if (!parsed.success) {
    return {
      status: 'failed',
      failure: {
        code: 'permission_rule_invalid',
        message: 'Permission rule is invalid.',
        details: {
          issues: parsed.error.issues,
        },
      },
    };
  }

  const { rule, session_id: sessionId } = parsed.data;
  if (rule.source !== 'session') {
    return {
      status: 'failed',
      failure: {
        code: 'permission_rule_source_unsupported',
        message: 'Only session permission rule writes are supported.',
      },
    };
  }

  if (!sessionId || sessionId !== rule.source_id) {
    return {
      status: 'failed',
      failure: {
        code: 'permission_session_mismatch',
        message: 'Session permission rule source_id must match request session_id.',
        details: {
          session_id: sessionId,
          source_id: rule.source_id,
        },
      },
    };
  }

  return {
    status: 'patch',
    patch: {
      permissions: {
        allow: [
          ...(current.permissions?.allow ?? []),
          rule,
        ],
      },
    },
  };
}

function filterRules(
  rules: Array<ReturnType<typeof PermissionRuleSchema.parse>>,
  request: ResolvePermissionSettingsRequest,
) {
  return rules.filter((rule) => {
    if (rule.source === 'user') {
      return true;
    }
    if (rule.source === 'workspace') {
      return Boolean(request.workspace_id && rule.source_id === request.workspace_id);
    }
    return Boolean(request.session_id && rule.source_id === request.session_id);
  });
}
