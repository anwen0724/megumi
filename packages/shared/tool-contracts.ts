import { z } from 'zod';
import type {
  IsoDateTime,
  ModelStepId,
  PermissionDecisionId,
  RunActionId,
  RunId,
  RunObservationId,
  RunStepId,
  ToolCallId,
  ToolResultId,
  ToolUseId,
} from './ids';
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from './json';
import { PermissionModeSchema, type PermissionMode } from './permission-mode-contracts';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-errors';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const ToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'Tool name must be Claude-compatible lowercase snake_case with letters, numbers, and underscores.');

export const ToolNameSchemaForUse = ToolNameSchema;
export type ToolName = z.infer<typeof ToolNameSchema>;

export const TOOL_CAPABILITIES = [
  'project_read',
  'project_write',
  'command_run',
  'network_access',
  'browser_access',
  'mcp_tool',
  'secret_read',
  'system_integration',
  'external_app',
] as const;
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];

export const TOOL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

export const TOOL_SIDE_EFFECTS = [
  'none',
  'read_external',
  'project_file_operation',
  'execute_command',
  'access_network',
  'access_secret',
  'modify_external',
  'system_change',
] as const;
export type ToolSideEffect = (typeof TOOL_SIDE_EFFECTS)[number];

export const TOOL_AVAILABILITY_STATUSES = ['available', 'disabled', 'unavailable'] as const;
export type ToolAvailabilityStatus = (typeof TOOL_AVAILABILITY_STATUSES)[number];

export const TOOL_USE_STATUSES = [
  'created',
  'validated',
  'queued_for_execution',
  'completed',
  'denied',
  'failed',
] as const;
export type ToolUseStatus = (typeof TOOL_USE_STATUSES)[number];

export const TOOL_CALL_STATUSES = [
  'requested',
  'validating',
  'waiting_for_approval',
  'approved',
  'denied',
  'running',
  'succeeded',
  'failed',
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const TOOL_OBSERVATION_STATUSES = ['succeeded', 'failed', 'denied'] as const;
export type ToolObservationStatus = (typeof TOOL_OBSERVATION_STATUSES)[number];

export const TOOL_RESULT_KINDS = [
  'success',
  'tool_error',
  'policy_denied',
  'user_rejected',
  'redacted',
] as const;
export type ToolResultKind = (typeof TOOL_RESULT_KINDS)[number];

export const TOOL_POLICY_DECISIONS = ['allow', 'ask', 'deny'] as const;
export type ToolPolicyDecisionValue = (typeof TOOL_POLICY_DECISIONS)[number];

export const PERMISSION_DECISION_SOURCES = [
  'rule',
  'protected_path',
  'sensitive_policy',
  'project_boundary',
  'user_rule',
  'project_rule',
  'local_rule',
  'permission_mode',
  'classifier',
  'hard_guard',
  'system_default',
] as const;
export type PermissionDecisionSource = (typeof PERMISSION_DECISION_SOURCES)[number];

export const PERMISSION_RULE_SCOPES = ['user', 'project', 'local', 'system'] as const;
export type PermissionRuleScope = (typeof PERMISSION_RULE_SCOPES)[number];

export const COMMAND_CLASSIFIER_LABELS = [
  'read_only',
  'verification',
  'search_or_list',
  'project_file_operation',
  'dependency_install',
  'git_read',
  'git_mutation',
  'network',
  'destructive',
  'infrastructure_or_deploy',
  'secret_or_env',
  'unknown',
] as const;
export type CommandClassifierLabel = (typeof COMMAND_CLASSIFIER_LABELS)[number];

export const PERMISSION_CLASSIFIER_LABELS = [
  ...COMMAND_CLASSIFIER_LABELS,
  'project_boundary',
  'sensitive_policy',
] as const;
export type PermissionClassifierLabel = (typeof PERMISSION_CLASSIFIER_LABELS)[number];

export const APPROVAL_SCOPES = ['once', 'run', 'project', 'local'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];
export const ApprovalScopeSchema = z.enum(APPROVAL_SCOPES);

export const APPROVAL_STATUSES = ['pending', 'approved', 'denied', 'expired', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SANDBOX_LEVELS = [
  'none',
  'read_only_project',
  'project_write',
  'restricted_command',
  'network_restricted',
  'host_restricted',
] as const;
export type SandboxLevel = (typeof SANDBOX_LEVELS)[number];

export const NETWORK_POLICIES = ['none', 'deny', 'allowlist', 'restricted'] as const;
export type NetworkPolicy = (typeof NETWORK_POLICIES)[number];

export const TOOL_TARGET_KINDS = [
  'file',
  'directory',
  'command',
  'url',
  'service',
  'workspace',
  'secret',
  'external_app',
  'unknown',
] as const;
export type ToolTargetKind = (typeof TOOL_TARGET_KINDS)[number];

export const TOOL_TARGET_SENSITIVITIES = ['normal', 'restricted', 'secret'] as const;
export type ToolTargetSensitivity = (typeof TOOL_TARGET_SENSITIVITIES)[number];

export const TOOL_REDACTION_STATES = ['none', 'redacted', 'blocked'] as const;
export type ToolRedactionState = (typeof TOOL_REDACTION_STATES)[number];

export const JsonSchemaObjectSchema = JsonObjectSchema.refine(
  (value) => typeof value.type === 'string' || value.properties !== undefined || value.$schema !== undefined,
  'JSON Schema object must include type, properties, or $schema.',
);
export type JsonSchemaObject = JsonObject;

export const ToolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

export const ToolAvailabilitySchema = z
  .object({
    status: z.enum(TOOL_AVAILABILITY_STATUSES),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type ToolAvailability = z.infer<typeof ToolAvailabilitySchema>;

export const ToolDefinitionSchema = z
  .object({
    name: ToolNameSchema,
    title: z.string().min(1).optional(),
    description: z.string().min(1),
    inputSchema: JsonSchemaObjectSchema,
    inputExamples: z.array(JsonObjectSchema).optional(),
    outputSchema: JsonSchemaObjectSchema.optional(),
    annotations: ToolAnnotationsSchema.optional(),
    capabilities: z.array(z.enum(TOOL_CAPABILITIES)).min(1),
    riskLevel: z.enum(TOOL_RISK_LEVELS),
    sideEffect: z.enum(TOOL_SIDE_EFFECTS),
    availability: ToolAvailabilitySchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolTargetPreviewSchema = z
  .object({
    kind: z.enum(TOOL_TARGET_KINDS),
    label: z.string().min(1),
    sensitivity: z.enum(TOOL_TARGET_SENSITIVITIES).optional(),
  })
  .strict();
export type ToolTargetPreview = z.infer<typeof ToolTargetPreviewSchema>;

export const ToolInputPreviewSchema = z
  .object({
    summary: z.string().min(1),
    targets: z.array(ToolTargetPreviewSchema),
    warnings: z.array(z.string().min(1)).optional(),
    redactionState: z.enum(TOOL_REDACTION_STATES),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ToolInputPreview = z.infer<typeof ToolInputPreviewSchema>;

export interface ToolUse {
  toolUseId: ToolUseId | string;
  runId: RunId | string;
  modelStepId: ModelStepId | string;
  providerToolUseId: string;
  toolName: ToolName;
  input: JsonValue;
  inputPreview: ToolInputPreview;
  status: ToolUseStatus;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const ToolUseSchema = z
  .object({
    toolUseId: IdSchema,
    runId: IdSchema,
    modelStepId: IdSchema,
    providerToolUseId: IdSchema,
    toolName: ToolNameSchema,
    input: JsonValueSchema,
    inputPreview: ToolInputPreviewSchema,
    status: z.enum(TOOL_USE_STATUSES),
    createdAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolUse>;

export const SandboxRequirementSchema = z
  .object({
    level: z.enum(SANDBOX_LEVELS),
    allowedRoots: z.array(z.string().min(1)).optional(),
    deniedRoots: z.array(z.string().min(1)).optional(),
    protectedPaths: z.array(z.string().min(1)).optional(),
    allowedCommands: z.array(z.string().min(1)).optional(),
    deniedCommands: z.array(z.string().min(1)).optional(),
    networkPolicy: z.enum(NETWORK_POLICIES).optional(),
    environmentPolicy: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type SandboxRequirement = z.infer<typeof SandboxRequirementSchema>;

export const ApprovalRequirementSchema = z
  .object({
    scope: ApprovalScopeSchema,
    reason: z.string().min(1),
  })
  .strict();
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const PermissionMatchedRuleSchema = z
  .object({
    scope: z.enum(PERMISSION_RULE_SCOPES),
    pattern: z.string().min(1),
    decision: z.enum(TOOL_POLICY_DECISIONS),
    reason: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type PermissionMatchedRule = z.infer<typeof PermissionMatchedRuleSchema>;

export interface PermissionDecision {
  permissionDecisionId: PermissionDecisionId | string;
  toolUseId: ToolUseId | string;
  toolCallId?: ToolCallId | string;
  runId: RunId | string;
  decision: ToolPolicyDecisionValue;
  source: PermissionDecisionSource;
  reason: string;
  mode: PermissionMode;
  matchedRule?: PermissionMatchedRule;
  classifierLabel?: PermissionClassifierLabel;
  target?: string;
  capability: ToolCapability;
  sideEffect: ToolSideEffect;
  effectiveRiskLevel: ToolRiskLevel;
  requiredApproval?: ApprovalRequirement;
  requiredSandbox?: SandboxRequirement;
  evaluatedAt: IsoDateTime;
  metadata?: JsonObject;
}

export const PermissionDecisionSchema = z
  .object({
    permissionDecisionId: IdSchema,
    toolUseId: IdSchema,
    toolCallId: IdSchema.optional(),
    runId: IdSchema,
    decision: z.enum(TOOL_POLICY_DECISIONS),
    source: z.enum(PERMISSION_DECISION_SOURCES),
    reason: z.string().min(1),
    mode: PermissionModeSchema,
    matchedRule: PermissionMatchedRuleSchema.optional(),
    classifierLabel: z.enum(PERMISSION_CLASSIFIER_LABELS).optional(),
    target: z.string().min(1).optional(),
    capability: z.enum(TOOL_CAPABILITIES),
    sideEffect: z.enum(TOOL_SIDE_EFFECTS),
    effectiveRiskLevel: z.enum(TOOL_RISK_LEVELS),
    requiredApproval: ApprovalRequirementSchema.optional(),
    requiredSandbox: SandboxRequirementSchema.optional(),
    evaluatedAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<PermissionDecision>;

export const ToolPolicyDecisionSchema = PermissionDecisionSchema;
export type ToolPolicyDecision = PermissionDecision;

export interface ToolCall {
  toolCallId: ToolCallId | string;
  toolUseId: ToolUseId | string;
  runId: RunId | string;
  stepId: RunStepId | string;
  actionId?: RunActionId | string;
  toolName: ToolName;
  input: JsonValue;
  inputPreview: ToolInputPreview;
  capabilities: ToolCapability[];
  riskLevel: ToolRiskLevel;
  sideEffect: ToolSideEffect;
  policyDecision?: PermissionDecision;
  approvalRequestId?: string;
  sandboxRequirement?: SandboxRequirement;
  status: ToolCallStatus;
  requestedAt: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  resultPreview?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const ToolCallSchema = z
  .object({
    toolCallId: IdSchema,
    toolUseId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    actionId: IdSchema.optional(),
    toolName: ToolNameSchema,
    input: JsonValueSchema,
    inputPreview: ToolInputPreviewSchema,
    capabilities: z.array(z.enum(TOOL_CAPABILITIES)).min(1),
    riskLevel: z.enum(TOOL_RISK_LEVELS),
    sideEffect: z.enum(TOOL_SIDE_EFFECTS),
    policyDecision: PermissionDecisionSchema.optional(),
    approvalRequestId: IdSchema.optional(),
    sandboxRequirement: SandboxRequirementSchema.optional(),
    status: z.enum(TOOL_CALL_STATUSES),
    requestedAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    resultPreview: z.string().optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolCall>;

export const ApprovalPreviewSchema = z
  .object({
    action: z.string().min(1),
    targets: z.array(ToolTargetPreviewSchema),
    warnings: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ApprovalPreview = z.infer<typeof ApprovalPreviewSchema>;

export const ApprovalRequestSchema = z
  .object({
    approvalRequestId: IdSchema,
    toolUseId: IdSchema,
    toolCallId: IdSchema,
    permissionDecisionId: IdSchema.optional(),
    runId: IdSchema,
    stepId: IdSchema,
    toolName: ToolNameSchema,
    capabilities: z.array(z.enum(TOOL_CAPABILITIES)).min(1),
    riskLevel: z.enum(TOOL_RISK_LEVELS),
    title: z.string().min(1),
    summary: z.string().min(1),
    preview: ApprovalPreviewSchema,
    requestedScope: ApprovalScopeSchema,
    status: z.enum(APPROVAL_STATUSES),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema.optional(),
    resolvedAt: IsoDateTimeSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalRecordSchema = z
  .object({
    approvalRecordId: IdSchema,
    approvalRequestId: IdSchema,
    toolCallId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    decision: z.enum(['approved', 'denied', 'expired', 'cancelled']),
    scope: ApprovalScopeSchema,
    decidedBy: z.enum(['user', 'host', 'system']),
    reason: z.string().min(1).optional(),
    decidedAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ToolContentRefSchema = z
  .object({
    contentRefId: IdSchema,
    kind: z.enum(['text', 'file', 'artifact', 'resource', 'binary', 'other']),
    label: z.string().min(1),
    uri: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ToolContentRef = z.infer<typeof ToolContentRefSchema>;

export interface ToolResult {
  toolResultId: ToolResultId | string;
  toolUseId: ToolUseId | string;
  toolCallId?: ToolCallId | string;
  runId: RunId | string;
  kind: ToolResultKind;
  structuredContent?: JsonValue;
  textContent?: string;
  contentRefs?: ToolContentRef[];
  error?: RuntimeError;
  denialReason?: string;
  redactionState: ToolRedactionState;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export const ToolResultSchema = z
  .object({
    toolResultId: IdSchema,
    toolUseId: IdSchema,
    toolCallId: IdSchema.optional(),
    runId: IdSchema,
    kind: z.enum(TOOL_RESULT_KINDS),
    structuredContent: JsonValueSchema.optional(),
    textContent: z.string().optional(),
    contentRefs: z.array(ToolContentRefSchema).optional(),
    error: RuntimeErrorSchema.optional(),
    denialReason: z.string().min(1).optional(),
    redactionState: z.enum(TOOL_REDACTION_STATES),
    createdAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolResult>;

export const ToolErrorSchema = RuntimeErrorSchema.extend({
  detailsPreview: JsonObjectSchema.optional(),
}).strict();
export type ToolError = z.infer<typeof ToolErrorSchema>;

export interface ToolObservation {
  observationId: RunObservationId | string;
  toolCallId: string;
  runId: RunId | string;
  stepId: RunStepId | string;
  status: ToolObservationStatus;
  summary: string;
  structuredContent?: JsonValue;
  textPreview?: string;
  contentRefs?: ToolContentRef[];
  error?: ToolError;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export const ToolObservationSchema = z
  .object({
    observationId: IdSchema,
    toolCallId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    status: z.enum(TOOL_OBSERVATION_STATUSES),
    summary: z.string().min(1),
    structuredContent: JsonValueSchema.optional(),
    textPreview: z.string().optional(),
    contentRefs: z.array(ToolContentRefSchema).optional(),
    error: ToolErrorSchema.optional(),
    createdAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolObservation>;
