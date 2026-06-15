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
  ToolExecutionId,
  ToolResultId,
} from '../primitives/ids';
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from '../primitives/json';
import { PermissionModeSchema, type PermissionMode } from '../permission/mode-contracts';
import { RuntimeErrorSchema, type RuntimeError } from '../runtime/errors';
import { IsoDateTimeSchema } from '../runtime/validation';

const IdSchema = z.string().min(1).max(128);
export const ToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'Tool name must be Claude-compatible lowercase snake_case with letters, numbers, and underscores.');

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

export const TOOL_SOURCE_KINDS = ['built_in', 'external_test', 'mcp', 'plugin', 'project_local'] as const;
export type ToolSourceKind = (typeof TOOL_SOURCE_KINDS)[number];

export const TOOL_SOURCE_AVAILABILITY_STATUSES = ['available', 'unavailable', 'unknown'] as const;
export type ToolSourceAvailabilityStatus = (typeof TOOL_SOURCE_AVAILABILITY_STATUSES)[number];

export const TOOL_EXECUTION_MODES = ['parallel', 'serial'] as const;
export type ToolExecutionMode = (typeof TOOL_EXECUTION_MODES)[number];

export const TOOL_REGISTRY_SNAPSHOT_ENTRY_STATUSES = ['available', 'disabled', 'unavailable', 'conflicted'] as const;
export type ToolRegistrySnapshotEntryStatus = (typeof TOOL_REGISTRY_SNAPSHOT_ENTRY_STATUSES)[number];

export const TOOL_CALL_STATUSES = [
  'created',
  'validated',
  'queued_for_execution',
  'completed',
  'denied',
  'failed',
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const TOOL_EXECUTION_STATUSES = [
  'created',
  'awaitingApproval',
  'rejected',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];

export const TOOL_EXECUTION_DECISION_OUTCOMES = ['allow', 'requireApproval', 'reject'] as const;
export type ToolExecutionDecisionOutcome = (typeof TOOL_EXECUTION_DECISION_OUTCOMES)[number];

export const TOOL_EXECUTION_CLASSES = [
  'readOnly',
  'workspaceMutation',
  'processExecution',
  'unknown',
] as const;
export type ToolExecutionClass = (typeof TOOL_EXECUTION_CLASSES)[number];

export const TOOL_EXECUTION_DECISION_REASON_CODES = [
  'BUILTIN_READ_ALLOWED',
  'WORKSPACE_MUTATION_REQUIRES_APPROVAL',
  'WORKSPACE_MUTATION_ALLOWED_BY_POSTURE',
  'PROCESS_REQUIRES_APPROVAL',
  'PROCESS_ALLOWED_BY_POSTURE',
  'CUSTOM_TOOL_REQUIRES_APPROVAL',
  'CUSTOM_TOOL_REJECTED',
  'TOOL_NOT_FOUND',
  'INVALID_ARGUMENTS',
  'PATH_OUTSIDE_WORKSPACE',
  'CAPABILITY_DISABLED',
] as const;
export type ToolExecutionDecisionReasonCode = (typeof TOOL_EXECUTION_DECISION_REASON_CODES)[number];

export interface ToolExecutionDecision {
  outcome: ToolExecutionDecisionOutcome;
  reasonCode: ToolExecutionDecisionReasonCode;
  reason: string;
  executionClass: ToolExecutionClass;
  executionMode: ToolExecutionMode;
}

export const TOOL_OBSERVATION_BUDGET_PROFILES = [
  'smallText',
  'largeText',
  'commandOutput',
  'fileRead',
  'error',
] as const;
export type ToolObservationBudgetProfile = (typeof TOOL_OBSERVATION_BUDGET_PROFILES)[number];

export const TOOL_OBSERVATION_TRUNCATION_REASONS = [
  'lineLimit',
  'byteLimit',
  'tokenBudget',
  'policy',
] as const;
export type ToolObservationTruncationReason = (typeof TOOL_OBSERVATION_TRUNCATION_REASONS)[number];

export type RawToolResultOutputKind =
  | 'text'
  | 'json'
  | 'command'
  | 'file'
  | 'diff'
  | 'error';

export interface RawToolResult {
  rawToolResultId: string;
  toolExecutionId: string;
  toolCallId: string;
  isError: boolean;
  outputKind: RawToolResultOutputKind;
  content: unknown;
  metadata?: JsonObject;
  createdAt: string;
}

export const TOOL_RESULT_KINDS = [
  'success',
  'tool_error',
  'policy_denied',
  'user_rejected',
  'redacted',
  'invalid_tool_call',
  'invalid_tool_input',
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

export const ToolSourceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]{0,127}$/, 'Tool source id must be lowercase snake_case.');
export type ToolSourceId = z.infer<typeof ToolSourceIdSchema>;

export const ToolNamespaceSchema = ToolNameSchema;
export type ToolNamespace = z.infer<typeof ToolNamespaceSchema>;

export const CanonicalToolIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/, 'Canonical tool id must be source:namespace:tool.');
export type CanonicalToolId = z.infer<typeof CanonicalToolIdSchema>;

export const ToolSourceIdentitySchema = z
  .object({
    registrySnapshotId: IdSchema,
    snapshotEntryId: IdSchema,
    modelVisibleName: ToolNameSchema,
    canonicalToolId: CanonicalToolIdSchema,
    sourceId: ToolSourceIdSchema,
    namespace: ToolNamespaceSchema,
    sourceToolName: ToolNameSchema,
  })
  .strict();
export type ToolSourceIdentity = z.infer<typeof ToolSourceIdentitySchema>;

const optionalToolSourceIdentitySchema = {
  registrySnapshotId: IdSchema.optional(),
  snapshotEntryId: IdSchema.optional(),
  modelVisibleName: ToolNameSchema.optional(),
  canonicalToolId: CanonicalToolIdSchema.optional(),
  sourceId: ToolSourceIdSchema.optional(),
  namespace: ToolNamespaceSchema.optional(),
  sourceToolName: ToolNameSchema.optional(),
};

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
    executionMode: z.enum(TOOL_EXECUTION_MODES).optional(),
    permissionMetadata: JsonObjectSchema.optional(),
    modelFacingDescription: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolSourceSchema = z
  .object({
    sourceId: ToolSourceIdSchema,
    sourceKind: z.enum(TOOL_SOURCE_KINDS),
    namespace: ToolNamespaceSchema,
    displayName: z.string().min(1),
    configured: z.boolean(),
    enabled: z.boolean(),
    availabilityStatus: z.enum(TOOL_SOURCE_AVAILABILITY_STATUSES),
    availabilityReason: z.string().min(1).optional(),
    healthCheckedAt: IsoDateTimeSchema.optional(),
    config: JsonObjectSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type ToolSource = z.infer<typeof ToolSourceSchema>;

export const ToolExecutorBindingSchema = z
  .object({
    kind: z.enum(TOOL_SOURCE_KINDS),
    bindingKey: z.string().min(1).optional(),
  })
  .strict();
export type ToolExecutorBinding = z.infer<typeof ToolExecutorBindingSchema>;

export const ToolRegistrationSchema = z
  .object({
    registrationId: IdSchema,
    sourceId: ToolSourceIdSchema,
    namespace: ToolNamespaceSchema,
    sourceToolName: ToolNameSchema,
    definition: ToolDefinitionSchema,
    enabled: z.boolean(),
    availability: ToolAvailabilitySchema,
    executorBinding: ToolExecutorBindingSchema,
    registrationMetadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ToolRegistration = z.infer<typeof ToolRegistrationSchema>;

export const ToolRegistrySnapshotSourceEntrySchema = ToolSourceSchema.pick({
  sourceId: true,
  sourceKind: true,
  namespace: true,
  displayName: true,
  configured: true,
  enabled: true,
  availabilityStatus: true,
  availabilityReason: true,
  healthCheckedAt: true,
});
export type ToolRegistrySnapshotSourceEntry = z.infer<typeof ToolRegistrySnapshotSourceEntrySchema>;

export const SnapshotToolEntrySchema = z
  .object({
    snapshotEntryId: IdSchema,
    snapshotId: IdSchema,
    registrationId: IdSchema,
    canonicalToolId: CanonicalToolIdSchema,
    modelVisibleName: ToolNameSchema,
    sourceId: ToolSourceIdSchema,
    namespace: ToolNamespaceSchema,
    sourceToolName: ToolNameSchema,
    definition: ToolDefinitionSchema,
    effectiveStatus: z.enum(TOOL_REGISTRY_SNAPSHOT_ENTRY_STATUSES),
    disabledReason: z.string().min(1).optional(),
    unavailableReason: z.string().min(1).optional(),
    conflictReason: z.string().min(1).optional(),
    exposedToModel: z.boolean(),
    executionMode: z.enum(TOOL_EXECUTION_MODES),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type SnapshotToolEntry = z.infer<typeof SnapshotToolEntrySchema>;

export const ToolRegistrySnapshotSchema = z
  .object({
    snapshotId: IdSchema,
    runId: IdSchema,
    projectId: IdSchema,
    permissionMode: z.string().min(1),
    modelId: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    registryVersion: z.number().int().min(1),
    sourceVersionHash: z.string().min(1),
    sourceEntries: z.array(ToolRegistrySnapshotSourceEntrySchema),
    entries: z.array(SnapshotToolEntrySchema),
  })
  .strict();
export type ToolRegistrySnapshot = z.infer<typeof ToolRegistrySnapshotSchema>;

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

export interface ToolCall {
  toolCallId: ToolCallId | string;
  runId: RunId | string;
  modelStepId: ModelStepId | string;
  providerToolCallId: string;
  toolName: ToolName;
  registrySnapshotId?: string;
  snapshotEntryId?: string;
  modelVisibleName?: ToolName;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: ToolNamespace;
  sourceToolName?: ToolName;
  input: JsonValue;
  inputPreview: ToolInputPreview;
  status: ToolCallStatus;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const ToolCallSchema = z
  .object({
    toolCallId: IdSchema,
    runId: IdSchema,
    modelStepId: IdSchema,
    providerToolCallId: IdSchema,
    toolName: ToolNameSchema,
    ...optionalToolSourceIdentitySchema,
    input: JsonValueSchema,
    inputPreview: ToolInputPreviewSchema,
    status: z.enum(TOOL_CALL_STATUSES),
    createdAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolCall>;

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
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  runId: RunId | string;
  registrySnapshotId?: string;
  snapshotEntryId?: string;
  modelVisibleName?: ToolName;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: ToolNamespace;
  sourceToolName?: ToolName;
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
    toolCallId: IdSchema,
    toolExecutionId: IdSchema.optional(),
    runId: IdSchema,
    ...optionalToolSourceIdentitySchema,
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

export interface ToolExecution {
  toolExecutionId: ToolExecutionId | string;
  toolCallId: ToolCallId | string;
  runId: RunId | string;
  stepId: RunStepId | string;
  assistantMessageId: string;
  callOrder: number;
  actionId?: RunActionId | string;
  toolName: ToolName;
  registrySnapshotId?: string;
  snapshotEntryId?: string;
  modelVisibleName?: ToolName;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: ToolNamespace;
  sourceToolName?: ToolName;
  input: JsonValue;
  inputPreview: JsonValue;
  capabilities?: readonly ToolCapability[];
  riskLevel?: ToolRiskLevel;
  sideEffect?: ToolSideEffect;
  decision?: ToolExecutionDecision;
  policyDecision?: PermissionDecision;
  approvalRequestId?: string;
  sandboxRequirement?: SandboxRequirement;
  executionMode?: ToolExecutionMode;
  status: ToolExecutionStatus;
  requestedAt: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  rawResultRef?: string;
  observation?: ToolObservation;
  continuationEmitted: boolean;
  resultPreview?: JsonValue;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export type ToolExecutionRecord = ToolExecution;

export const ToolExecutionSchema = z
  .object({
    toolExecutionId: IdSchema,
    toolCallId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    assistantMessageId: IdSchema,
    callOrder: z.number().int().nonnegative(),
    actionId: IdSchema.optional(),
    toolName: ToolNameSchema,
    ...optionalToolSourceIdentitySchema,
    input: JsonValueSchema,
    inputPreview: JsonValueSchema,
    capabilities: z.array(z.enum(TOOL_CAPABILITIES)).optional(),
    riskLevel: z.enum(TOOL_RISK_LEVELS).optional(),
    sideEffect: z.enum(TOOL_SIDE_EFFECTS).optional(),
    decision: z.object({
      outcome: z.enum(TOOL_EXECUTION_DECISION_OUTCOMES),
      reasonCode: z.enum(TOOL_EXECUTION_DECISION_REASON_CODES),
      reason: z.string().min(1),
      executionClass: z.enum(TOOL_EXECUTION_CLASSES),
      executionMode: z.enum(TOOL_EXECUTION_MODES),
    }).strict().optional(),
    policyDecision: PermissionDecisionSchema.optional(),
    approvalRequestId: IdSchema.optional(),
    sandboxRequirement: SandboxRequirementSchema.optional(),
    executionMode: z.enum(TOOL_EXECUTION_MODES).optional(),
    status: z.enum(TOOL_EXECUTION_STATUSES),
    requestedAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    rawResultRef: z.string().min(1).optional(),
    observation: z.lazy(() => ToolObservationSchema).optional(),
    continuationEmitted: z.boolean(),
    resultPreview: JsonValueSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolExecution>;

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
    toolCallId: IdSchema,
    toolExecutionId: IdSchema,
    permissionDecisionId: IdSchema.optional(),
    runId: IdSchema,
    stepId: IdSchema,
    toolName: ToolNameSchema,
    ...optionalToolSourceIdentitySchema,
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
    toolExecutionId: IdSchema,
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
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  observationId?: string;
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
    toolCallId: IdSchema,
    toolExecutionId: IdSchema.optional(),
    observationId: IdSchema.optional(),
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
  toolExecutionId: ToolExecutionId | string;
  toolCallId: ToolCallId | string;
  runId: RunId | string;
  stepId: RunStepId | string;
  kind: 'text';
  isError: boolean;
  content: string;
  truncated: boolean;
  truncationReason?: ToolObservationTruncationReason;
  rawResultRef?: string;
  continuationHint?: string;
  byteLength: number;
  tokenEstimate?: number;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export const ToolObservationSchema = z
  .object({
    observationId: IdSchema,
    toolExecutionId: IdSchema,
    toolCallId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    kind: z.literal('text'),
    isError: z.boolean(),
    content: z.string(),
    truncated: z.boolean(),
    truncationReason: z.enum(TOOL_OBSERVATION_TRUNCATION_REASONS).optional(),
    rawResultRef: z.string().min(1).optional(),
    continuationHint: z.string().min(1).optional(),
    byteLength: z.number().int().nonnegative(),
    tokenEstimate: z.number().int().nonnegative().optional(),
    createdAt: IsoDateTimeSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict() satisfies z.ZodType<ToolObservation>;

