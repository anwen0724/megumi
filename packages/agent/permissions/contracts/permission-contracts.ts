/*
 * Public contracts for Permissions tool execution decisions.
 * These types are owned by Permissions and avoid legacy shared permission/tool contracts.
 */
import { z } from 'zod';

export const PermissionModeSchema = z.enum(['default', 'accept_edits', 'plan', 'auto']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

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

export const PermissionSettingsSchema = z
  .object({
    allow: z.array(PermissionRuleSchema),
    ask: z.array(PermissionRuleSchema),
    deny: z.array(PermissionRuleSchema),
  })
  .strict();
export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;

export const RuntimeCapabilityPolicySchema = z
  .object({
    custom_tools_enabled: z.boolean(),
    process_execution_enabled: z.boolean(),
    network_enabled: z.boolean(),
  })
  .strict();
export type RuntimeCapabilityPolicy = z.infer<typeof RuntimeCapabilityPolicySchema>;

export const PermissionExecutionClassSchema = z.enum([
  'read_only',
  'workspace_mutation',
  'process_execution',
  'network',
  'custom_tool',
  'unknown',
]);
export type PermissionExecutionClass = z.infer<typeof PermissionExecutionClassSchema>;

export const PermissionDenialCodeSchema = z.enum([
  'tool_not_found',
  'capability_disabled',
  'outside_workspace',
  'protected_path',
  'destructive_command',
  'rule_denied',
  'policy_denied',
]);
export type PermissionDenialCode = z.infer<typeof PermissionDenialCodeSchema>;

export const SandboxRequirementSchema = z
  .object({
    level: z.enum([
      'none',
      'read_only_project',
      'project_write',
      'restricted_command',
      'network_restricted',
    ]),
    allowed_roots: z.array(z.string().min(1)).optional(),
    network_policy: z.enum(['deny', 'allowlist', 'restricted']).optional(),
  })
  .strict();
export type SandboxRequirement = z.infer<typeof SandboxRequirementSchema>;

export const RuntimeErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

const ApprovalScopeValueSchema = z.enum(['once', 'session']);

export const PermissionDecisionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('allow'),
      reason: z.string().min(1),
      execution_class: PermissionExecutionClassSchema,
      sandbox: SandboxRequirementSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('deny'),
      reason: z.string().min(1),
      execution_class: PermissionExecutionClassSchema,
      denial_code: PermissionDenialCodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('requires_approval'),
      reason: z.string().min(1),
      execution_class: PermissionExecutionClassSchema,
      approval: z
        .object({
          allowed_scopes: z.array(ApprovalScopeValueSchema).min(1),
          default_scope: ApprovalScopeValueSchema,
        })
        .strict()
        .superRefine((approval, ctx) => {
          if (!approval.allowed_scopes.includes(approval.default_scope)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['default_scope'],
              message: 'default_scope must be included in allowed_scopes',
            });
          }
        }),
      sandbox: SandboxRequirementSchema.optional(),
    })
    .strict(),
]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const ToolCapabilitySchema = z.enum([
  'project_read',
  'project_write',
  'command_run',
  'network_access',
  'browser_access',
  'custom',
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const ToolRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevelSchema>;

export const ToolSideEffectSchema = z.enum([
  'none',
  'project_file_operation',
  'process_execution',
  'network',
  'external',
]);
export type ToolSideEffect = z.infer<typeof ToolSideEffectSchema>;

export const RegisteredToolPermissionFactsSchema = z
  .object({
    registered_tool_name: z.string().min(1),
    source_id: z.string().min(1),
    source_tool_name: z.string().min(1),
    capabilities: z.array(ToolCapabilitySchema),
    risk_level: ToolRiskLevelSchema,
    side_effect: ToolSideEffectSchema,
    permission_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RegisteredToolPermissionFacts = z.infer<typeof RegisteredToolPermissionFactsSchema>;

export const WorkspacePathPermissionFactsSchema = z
  .object({
    inside_workspace: z.boolean(),
    protected: z.boolean(),
    sensitive: z.boolean(),
    workspace_path: z.string().min(1).optional(),
  })
  .strict();
export type WorkspacePathPermissionFacts = z.infer<typeof WorkspacePathPermissionFactsSchema>;

export const EvaluateToolExecutionRequestSchema = z
  .object({
    run_id: z.string().min(1),
    tool_call_id: z.string().min(1),
    tool_name: z.string().min(1),
    tool_input: z.unknown(),
    registered_tool: RegisteredToolPermissionFactsSchema.optional(),
    permission_mode: PermissionModeSchema,
    permission_settings: PermissionSettingsSchema.optional(),
    workspace_path: WorkspacePathPermissionFactsSchema.optional(),
    runtime_capability_policy: RuntimeCapabilityPolicySchema,
    evaluated_at: z.string().min(1),
  })
  .strict();
export type EvaluateToolExecutionRequest = z.infer<typeof EvaluateToolExecutionRequestSchema>;

export const EvaluateToolExecutionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      decision: PermissionDecisionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      failure: RuntimeErrorSchema,
    })
    .strict(),
]);
export type EvaluateToolExecutionResult = z.infer<typeof EvaluateToolExecutionResultSchema>;
