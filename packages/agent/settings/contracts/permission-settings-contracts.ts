/*
 * Defines Settings-owned permission rule storage contracts.
 * Settings stores and filters rules; it does not evaluate permission decisions.
 */
import { z } from 'zod';
import type {
  SettingsError,
  SettingsResolved,
} from './settings-contracts';

export const PermissionRuleSchema = z
  .object({
    source: z.enum(['user', 'workspace', 'session']),
    source_id: z.string().min(1).optional(),
    pattern: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.source === 'session' && !rule.source_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_id'],
        message: 'session permission rule requires source_id',
      });
    }
  });
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionRulesRawSchema = z
  .object({
    allow: z.array(PermissionRuleSchema).optional(),
    ask: z.array(PermissionRuleSchema).optional(),
    deny: z.array(PermissionRuleSchema).optional(),
  })
  .strict();
export type PermissionRulesRaw = z.infer<typeof PermissionRulesRawSchema>;

export const PermissionRulesResolvedSchema = z
  .object({
    allow: z.array(PermissionRuleSchema),
    ask: z.array(PermissionRuleSchema),
    deny: z.array(PermissionRuleSchema),
  })
  .strict();
export type ResolvedPermissionSettings = z.infer<typeof PermissionRulesResolvedSchema>;

export const ResolvePermissionSettingsRequestSchema = z
  .object({
    user_id: z.string().min(1).optional(),
    workspace_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
  })
  .strict();
export type ResolvePermissionSettingsRequest = z.infer<typeof ResolvePermissionSettingsRequestSchema>;

export type ResolvePermissionSettingsResult =
  | { status: 'ok'; permission_settings: ResolvedPermissionSettings }
  | { status: 'failed'; failure: SettingsError };

export const AddPermissionRuleRequestSchema = z
  .object({
    rule: PermissionRuleSchema,
    session_id: z.string().min(1).optional(),
  })
  .strict();
export type AddPermissionRuleRequest = z.infer<typeof AddPermissionRuleRequestSchema>;

export type AddPermissionRuleResult =
  | { status: 'saved'; settings: SettingsResolved }
  | { status: 'failed'; failure: SettingsError };
