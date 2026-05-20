import { z } from 'zod';

export const PERMISSION_SETTINGS_SCOPES = ['user', 'project', 'local'] as const;
export type PermissionSettingsScope = (typeof PERMISSION_SETTINGS_SCOPES)[number];

export const PermissionRulePatternSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z][a-z0-9_]{0,63}\([^)]*\)$/, 'Permission rule must use tool_name(argument-pattern).')
  .refine((value) => !/bypassPermissions|dontAsk|bypass_permissions/i.test(value), {
    message: 'Permission rule must not use bypass-style settings.',
  });

export type PermissionRulePattern = z.infer<typeof PermissionRulePatternSchema>;

export const PermissionRulesSchema = z
  .object({
    allow: z.array(PermissionRulePatternSchema).optional(),
    ask: z.array(PermissionRulePatternSchema).optional(),
    deny: z.array(PermissionRulePatternSchema).optional(),
  })
  .strict();

export type PermissionRules = z.infer<typeof PermissionRulesSchema>;

export const PermissionSettingsSchema = z
  .object({
    permissions: PermissionRulesSchema.default({}),
  })
  .strict();

export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;

export interface ScopedPermissionSettings {
  scope: PermissionSettingsScope;
  settings: PermissionSettings;
}

export interface FlattenedPermissionRule {
  scope: PermissionSettingsScope;
  pattern: PermissionRulePattern;
}

export interface MergedPermissionSettings {
  allow: FlattenedPermissionRule[];
  ask: FlattenedPermissionRule[];
  deny: FlattenedPermissionRule[];
}

export function mergePermissionSettingsScopes(
  scopes: readonly ScopedPermissionSettings[],
): MergedPermissionSettings {
  return {
    allow: flatten(scopes, 'allow'),
    ask: flatten(scopes, 'ask'),
    deny: flatten(scopes, 'deny'),
  };
}

function flatten(
  scopes: readonly ScopedPermissionSettings[],
  key: keyof PermissionRules,
): FlattenedPermissionRule[] {
  return scopes.flatMap((scope) =>
    (scope.settings.permissions[key] ?? []).map((pattern) => ({
      scope: scope.scope,
      pattern,
    })),
  );
}
