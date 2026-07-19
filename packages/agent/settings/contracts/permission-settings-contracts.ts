/*
 * Defines Settings-owned persistence and resolution contracts for action permissions.
 * Settings validates and scopes rules; it never interprets their security meaning.
 */
import { z } from 'zod';
import {
  PermissionModeSchema,
  PermissionRuleSchema,
} from '../../permissions/contracts/permission-contracts';
import type { SettingsError, SettingsResolved } from './settings-contracts';

export { PermissionRuleSchema };
export type { PermissionRule } from '../../permissions/contracts/permission-contracts';

export const PermissionRulesRawSchema = z.object({
  mode: PermissionModeSchema.optional(),
  allow: z.array(PermissionRuleSchema).optional(),
  ask: z.array(PermissionRuleSchema).optional(),
  deny: z.array(PermissionRuleSchema).optional(),
}).strict();
export type PermissionRulesRaw = z.infer<typeof PermissionRulesRawSchema>;

export const PermissionRulesResolvedSchema = z.object({
  mode: PermissionModeSchema,
  allow: z.array(PermissionRuleSchema),
  ask: z.array(PermissionRuleSchema),
  deny: z.array(PermissionRuleSchema),
}).strict();
export type ResolvedPermissionSettings = z.infer<typeof PermissionRulesResolvedSchema>;

export const ResolvePermissionSettingsRequestSchema = z.object({
  user_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
}).strict();
export type ResolvePermissionSettingsRequest = z.infer<typeof ResolvePermissionSettingsRequestSchema>;

export type ResolvePermissionSettingsResult =
  | { status: 'ok'; permission_settings: ResolvedPermissionSettings }
  | { status: 'failed'; failure: SettingsError };

export const AddPermissionRulesRequestSchema = z.object({
  rules: z.array(PermissionRuleSchema).min(1),
  session_id: z.string().min(1),
  applied_at: z.string().min(1).optional(),
}).strict();
export type AddPermissionRulesRequest = z.infer<typeof AddPermissionRulesRequestSchema>;

export type AddPermissionRulesResult =
  | { status: 'saved'; settings: SettingsResolved }
  | { status: 'failed'; failure: SettingsError };

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
export type ChangePermissionRulesResult = AddPermissionRulesResult;
