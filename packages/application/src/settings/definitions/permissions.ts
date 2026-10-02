/* Defines persisted permission configuration using the permission module's rules. */
import { z } from 'zod';
import {
  PermissionModeSchema,
  PermissionRuleSchema,
} from '@megumi/agent-runtime/permissions/index';

export const PermissionsConfigurationSchema = z
  .object({
    mode: PermissionModeSchema.default('ask'),
    allow: z.array(PermissionRuleSchema).default([]),
    ask: z.array(PermissionRuleSchema).default([]),
    deny: z.array(PermissionRuleSchema).default([]),
  })
  .default({});
