import { z } from 'zod';
import { ContextBudgetWarningSchema, type ContextBudgetWarning } from '../context/budget-contracts';
import type { IsoDateTime } from '../primitives/ids';
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from '../primitives/json';
import { IsoDateTimeSchema } from '../runtime/validation';

const IdSchema = z.string().min(1).max(128);
const NonEmptyTextSchema = z.string().min(1);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const MODEL_INPUT_CONTEXT_PART_KINDS = [
  'instruction',
  'current_turn',
  'session',
  'tool_continuation',
  'runtime_constraint',
  'memory',
] as const;
export type ModelInputContextPartKind = (typeof MODEL_INPUT_CONTEXT_PART_KINDS)[number];

export const MODEL_INPUT_CONTEXT_SOURCE_KINDS = [
  'system_instruction',
  'global_instruction',
  'project_instruction',
  'session_instruction',
  'mode_instruction',
  'current_user_message',
  'run_goal',
  'timeline_message',
  'session_context',
  'session_message',
  'session_run',
  'session_step',
  'session_runtime_fact',
  'session_summary',
  'branch_marker',
  'retry_attempt',
  'interrupted_run_marker',
  'tool_call',
  'tool_result',
  'approval',
  'provider_state',
  'permission_constraint',
  'permission_mode',
  'project_boundary',
  'runtime_constraint',
  'runtime_fact',
  'input_intent',
  'input_prompt_template',
  'input_skill',
  'input_hook',
  'memory_recall',
  'external_resource',
  'other',
] as const;
export type ModelInputContextSourceKind = (typeof MODEL_INPUT_CONTEXT_SOURCE_KINDS)[number];

export const MODEL_INPUT_CONTEXT_CANONICAL_SOURCE_KINDS = [
  'system_instruction',
  'global_instruction',
  'project_instruction',
  'session_instruction',
  'input_instruction',
  'permission_constraint',
  'session_context',
  'tool_continuation',
  'memory_recall',
  'runtime_fact',
] as const;
export const ModelInputContextCanonicalSourceKindSchema = z.enum(MODEL_INPUT_CONTEXT_CANONICAL_SOURCE_KINDS);
export type ModelInputContextCanonicalSourceKind = (typeof MODEL_INPUT_CONTEXT_CANONICAL_SOURCE_KINDS)[number];

export const MODEL_INPUT_CONTEXT_BUDGET_STATUSES = [
  'included_full',
  'included_truncated',
  'included_reduced',
] as const;
export type ModelInputContextBudgetStatus = (typeof MODEL_INPUT_CONTEXT_BUDGET_STATUSES)[number];

export const MODEL_INPUT_CONTEXT_BUDGET_CLASSES = [
  'required',
  'high_priority',
  'contextual',
  'continuation',
  'diagnostic_only',
] as const;
export const ModelInputContextBudgetClassSchema = z.enum(MODEL_INPUT_CONTEXT_BUDGET_CLASSES);
export type ModelInputContextBudgetClass = (typeof MODEL_INPUT_CONTEXT_BUDGET_CLASSES)[number];

export const MODEL_INPUT_CONTEXT_SOURCE_ORIGINS = [
  'system',
  'desktop_main',
  'project_file',
  'session_state',
  'input_preprocessing',
  'tool_runtime',
  'memory_runtime',
  'context_management',
] as const;
export const ModelInputContextSourceOriginSchema = z.enum(MODEL_INPUT_CONTEXT_SOURCE_ORIGINS);
export type ModelInputContextSourceOrigin = (typeof MODEL_INPUT_CONTEXT_SOURCE_ORIGINS)[number];

export const MODEL_INPUT_CONTEXT_SOURCE_VISIBILITIES = [
  'model_visible',
  'trace_only',
  'host_only',
] as const;
export const ModelInputContextSourceVisibilitySchema = z.enum(MODEL_INPUT_CONTEXT_SOURCE_VISIBILITIES);
export type ModelInputContextSourceVisibility = (typeof MODEL_INPUT_CONTEXT_SOURCE_VISIBILITIES)[number];

export const MODEL_INPUT_CONTEXT_SOURCE_FAILURE_BEHAVIORS = [
  'block_model_step',
  'degrade',
  'drop',
  'trace_only',
] as const;
export const ModelInputContextSourceFailureBehaviorSchema = z.enum(MODEL_INPUT_CONTEXT_SOURCE_FAILURE_BEHAVIORS);
export type ModelInputContextSourceFailureBehavior = (typeof MODEL_INPUT_CONTEXT_SOURCE_FAILURE_BEHAVIORS)[number];

export const ModelInputContextSourceScopeSchema = z
  .object({
    kind: z.enum(['global', 'project', 'directory', 'session', 'run', 'step', 'tool', 'memory']),
    sessionId: IdSchema.optional(),
    runId: IdSchema.optional(),
    stepId: IdSchema.optional(),
    projectId: IdSchema.optional(),
    projectRoot: z.string().min(1).optional(),
    effectiveCwd: z.string().min(1).optional(),
    relativePath: z.string().min(1).optional(),
    depth: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ModelInputContextSourceScope = z.infer<typeof ModelInputContextSourceScopeSchema>;

export const ModelInputContextSourceTraceSchema = z
  .object({
    discoveryStatus: z.enum(['included', 'included_truncated', 'missing', 'unavailable', 'read_failed', 'blocked', 'dropped']),
    redactionStatus: z.enum(['not_required', 'passed', 'redacted', 'blocked']).default('not_required'),
    materializationStatus: z.enum(['included_full', 'included_truncated', 'included_reduced', 'dropped', 'trace_only']),
    loadedBytes: z.number().int().nonnegative().optional(),
    loadedChars: z.number().int().nonnegative().optional(),
    materializedPartId: IdSchema.optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type ModelInputContextSourceTrace = z.infer<typeof ModelInputContextSourceTraceSchema>;

export const ModelInputContextSourceDiagnosticSchema = z
  .object({
    severity: z.enum(['info', 'warning', 'error']),
    reason: z.string().min(1),
    message: z.string().min(1).optional(),
    conflictingSourceIds: z.array(IdSchema).optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();
export type ModelInputContextSourceDiagnostic = z.infer<typeof ModelInputContextSourceDiagnosticSchema>;

export const ModelInputContextSourceContentSchema = z
  .object({
    text: z.string().min(1).optional(),
    structuredPayload: JsonValueSchema.optional(),
  })
  .strict()
  .refine((value) => value.text !== undefined || value.structuredPayload !== undefined, {
    message: 'Context source content requires text or structuredPayload.',
  });
export type ModelInputContextSourceContent = z.infer<typeof ModelInputContextSourceContentSchema>;

export const AGENT_INSTRUCTION_SOURCE_STATUSES = [
  'included',
  'included_truncated',
  'missing',
  'unavailable',
  'read_failed',
] as const;
export type AgentInstructionSourceStatus = (typeof AGENT_INSTRUCTION_SOURCE_STATUSES)[number];

export const MODEL_INPUT_INSTRUCTION_KINDS = [
  'system',
  'global',
  'project',
  'session',
  'mode',
  'developer',
  'user',
  'intent',
  'prompt_template',
  'skill',
  'input_hook',
] as const;
export const ModelInputInstructionKindSchema = z.enum(MODEL_INPUT_INSTRUCTION_KINDS);
export type ModelInputInstructionKind = (typeof MODEL_INPUT_INSTRUCTION_KINDS)[number];

export const MODEL_INPUT_CURRENT_TURN_ROLES = ['user', 'host'] as const;
export type ModelInputCurrentTurnRole = (typeof MODEL_INPUT_CURRENT_TURN_ROLES)[number];

export const MODEL_INPUT_SESSION_PART_KINDS = [
  'session_history',
  'session_runtime_fact',
  'session_summary',
] as const;
export type ModelInputSessionPartKind = (typeof MODEL_INPUT_SESSION_PART_KINDS)[number];

export const MODEL_INPUT_RUNTIME_CONSTRAINT_KINDS = [
  'permission_mode',
  'project_boundary',
  'sandbox',
  'approval',
  'sensitive_content',
  'effective_cwd',
  'available_capability_summary',
  'permission_posture',
  'other',
] as const;
export type ModelInputRuntimeConstraintKind = (typeof MODEL_INPUT_RUNTIME_CONSTRAINT_KINDS)[number];

export const ModelInputContextSourceRefSchema = z
  .object({
    sourceId: IdSchema,
    sourceKind: z.enum(MODEL_INPUT_CONTEXT_SOURCE_KINDS),
    sourceUri: z.string().min(1).optional(),
    loadedAt: IsoDateTimeSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ModelInputContextSourceRef {
  sourceId: string;
  sourceKind: ModelInputContextSourceKind;
  sourceUri?: string;
  loadedAt?: IsoDateTime;
  metadata?: JsonObject;
}

export const ModelInputContextSourceSchema = z
  .object({
    id: IdSchema,
    kind: ModelInputContextCanonicalSourceKindSchema,
    origin: ModelInputContextSourceOriginSchema,
    scope: ModelInputContextSourceScopeSchema,
    visibility: ModelInputContextSourceVisibilitySchema,
    priority: z.number().int().nonnegative(),
    budgetClass: ModelInputContextBudgetClassSchema,
    content: ModelInputContextSourceContentSchema.optional(),
    trace: ModelInputContextSourceTraceSchema,
    diagnostics: z.array(ModelInputContextSourceDiagnosticSchema),
    failureBehavior: ModelInputContextSourceFailureBehaviorSchema,
    sourceRef: ModelInputContextSourceRefSchema.optional(),
  })
  .strict();
export type ModelInputContextSource = z.infer<typeof ModelInputContextSourceSchema>;

const InstructionSourceRelativePathSchema = z
  .string()
  .min(1)
  .refine(isSafeInstructionRelativePath, 'Instruction source relative path must stay project-relative.');

const InstructionSourceUriSchema = z
  .string()
  .min(1)
  .refine(isSafeInstructionSourceUri, 'Instruction source URI must use an instruction source scheme.');

const AgentInstructionSourceSnapshotBaseSchema = z
  .object({
    sourceId: IdSchema,
    sourceKind: z.enum(['global_instruction', 'project_instruction']),
    sourceUri: InstructionSourceUriSchema.optional(),
    relativePath: InstructionSourceRelativePathSchema.optional(),
    loadedAt: IsoDateTimeSchema,
  })
  .strict();

export const AgentInstructionSourceSnapshotSchema = z.discriminatedUnion('status', [
  AgentInstructionSourceSnapshotBaseSchema.extend({
    status: z.literal('included'),
    text: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    includedBytes: z.number().int().nonnegative(),
    hardCapBytes: z.number().int().positive(),
    truncated: z.literal(false),
    reason: z.string().min(1).optional(),
  }).strict(),
  AgentInstructionSourceSnapshotBaseSchema.extend({
    status: z.literal('included_truncated'),
    text: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    includedBytes: z.number().int().nonnegative(),
    hardCapBytes: z.number().int().positive(),
    truncated: z.literal(true),
    reason: z.literal('project_instruction_hard_cap_exceeded'),
  }).strict(),
  AgentInstructionSourceSnapshotBaseSchema.extend({
    status: z.literal('missing'),
    text: z.never().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    includedBytes: z.number().int().nonnegative().optional(),
    hardCapBytes: z.number().int().positive().optional(),
    truncated: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  }).strict(),
  AgentInstructionSourceSnapshotBaseSchema.extend({
    status: z.literal('unavailable'),
    text: z.never().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    includedBytes: z.number().int().nonnegative().optional(),
    hardCapBytes: z.number().int().positive().optional(),
    truncated: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  }).strict(),
  AgentInstructionSourceSnapshotBaseSchema.extend({
    status: z.literal('read_failed'),
    text: z.never().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    includedBytes: z.number().int().nonnegative().optional(),
    hardCapBytes: z.number().int().positive().optional(),
    truncated: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  }).strict(),
]);

interface AgentInstructionSourceSnapshotBase {
  sourceId: string;
  sourceKind: 'global_instruction' | 'project_instruction';
  sourceUri?: string;
  relativePath?: string;
  loadedAt: IsoDateTime;
}

function isSafeInstructionSourceUri(value: string): boolean {
  if (value === 'project://AGENTS.md') {
    return true;
  }

  for (const prefix of ['project-instruction://', 'global-instruction://']) {
    if (value.startsWith(prefix)) {
      return isSafeInstructionRelativePath(value.slice(prefix.length));
    }
  }

  return false;
}

function isSafeInstructionRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized === value
    && normalized.trim() === normalized
    && !normalized.includes('//')
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:/.test(normalized)
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../')
    && !normalized.endsWith('/..');
}

export type AgentInstructionSourceSnapshot =
  | (AgentInstructionSourceSnapshotBase & {
      status: 'included';
      text: string;
      sizeBytes: number;
      includedBytes: number;
      hardCapBytes: number;
      truncated: false;
      reason?: string;
    })
  | (AgentInstructionSourceSnapshotBase & {
      status: 'included_truncated';
      text: string;
      sizeBytes: number;
      includedBytes: number;
      hardCapBytes: number;
      truncated: true;
      reason: 'project_instruction_hard_cap_exceeded';
    })
  | (AgentInstructionSourceSnapshotBase & {
      status: Exclude<AgentInstructionSourceStatus, 'included' | 'included_truncated'>;
      text?: never;
      sizeBytes?: number;
      includedBytes?: number;
      hardCapBytes?: number;
      truncated?: boolean;
      reason?: string;
    });

export const SESSION_INSTRUCTION_SOURCE_KINDS = [
  'session_instruction',
  'mode_instruction',
] as const;
export type SessionInstructionSourceKind = (typeof SESSION_INSTRUCTION_SOURCE_KINDS)[number];

export const SessionInstructionSourceSnapshotSchema = z
  .object({
    sourceId: IdSchema,
    sourceKind: z.enum(SESSION_INSTRUCTION_SOURCE_KINDS),
    text: NonEmptyTextSchema,
    sourceUri: z.string().min(1).optional(),
    loadedAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface SessionInstructionSourceSnapshot {
  sourceId: string;
  sourceKind: SessionInstructionSourceKind;
  text: string;
  sourceUri?: string;
  loadedAt: IsoDateTime;
  metadata?: JsonObject;
}

export const ModelInputContextTruncationSchema = z
  .object({
    originalTokenEstimate: z.number().int().nonnegative().optional(),
    retainedTokenEstimate: z.number().int().nonnegative().optional(),
    reason: z.string().min(1),
  })
  .strict();

export interface ModelInputContextTruncation {
  originalTokenEstimate?: number;
  retainedTokenEstimate?: number;
  reason: string;
}

const ModelInputContextPartBaseSchema = z
  .object({
    partId: IdSchema,
    sourceRefs: z.array(ModelInputContextSourceRefSchema).min(1),
    priority: z.number().int().min(0).max(100),
    tokenEstimate: z.number().int().nonnegative().optional(),
    budgetStatus: z.enum(MODEL_INPUT_CONTEXT_BUDGET_STATUSES),
    budgetClass: ModelInputContextBudgetClassSchema.optional(),
    truncation: ModelInputContextTruncationSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ModelInputContextPartBase {
  partId: string;
  kind: ModelInputContextPartKind;
  sourceRefs: ModelInputContextSourceRef[];
  priority: number;
  tokenEstimate?: number;
  budgetStatus: ModelInputContextBudgetStatus;
  budgetClass?: ModelInputContextBudgetClass;
  truncation?: ModelInputContextTruncation;
  metadata?: JsonObject;
}

export const InstructionPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('instruction'),
  instructionKind: ModelInputInstructionKindSchema,
  text: NonEmptyTextSchema,
}).strict();

export interface InstructionPart extends ModelInputContextPartBase {
  kind: 'instruction';
  instructionKind: ModelInputInstructionKind;
  text: string;
}

export const CurrentTurnPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('current_turn'),
  role: z.enum(MODEL_INPUT_CURRENT_TURN_ROLES),
  text: NonEmptyTextSchema,
}).strict();

export interface CurrentTurnPart extends ModelInputContextPartBase {
  kind: 'current_turn';
  role: ModelInputCurrentTurnRole;
  text: string;
}

export const SessionPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('session'),
  sessionKind: z.enum(MODEL_INPUT_SESSION_PART_KINDS),
  text: NonEmptyTextSchema,
}).strict();

export interface SessionPart extends ModelInputContextPartBase {
  kind: 'session';
  sessionKind: ModelInputSessionPartKind;
  text: string;
}

export const ToolContinuationPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('tool_continuation'),
  text: NonEmptyTextSchema,
  toolCallId: IdSchema.optional(),
  providerToolCallId: IdSchema.optional(),
  toolExecutionId: IdSchema.optional(),
  modelStepId: IdSchema.optional(),
  toolName: z.string().min(1).max(64).optional(),
  toolInput: JsonValueSchema.optional(),
  toolResultId: IdSchema.optional(),
  toolResultContent: z.string().optional(),
  providerStateIds: z.array(IdSchema).optional(),
  providerStateText: z.string().min(1).optional(),
}).strict();

export interface ToolContinuationPart extends ModelInputContextPartBase {
  kind: 'tool_continuation';
  text: string;
  toolCallId?: string;
  providerToolCallId?: string;
  toolExecutionId?: string;
  modelStepId?: string;
  toolName?: string;
  toolInput?: JsonValue;
  toolResultId?: string;
  toolResultContent?: string;
  providerStateIds?: string[];
  providerStateText?: string;
}

export const RuntimeConstraintPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('runtime_constraint'),
  constraintKind: z.enum(MODEL_INPUT_RUNTIME_CONSTRAINT_KINDS),
  text: NonEmptyTextSchema,
}).strict();

export interface RuntimeConstraintPart extends ModelInputContextPartBase {
  kind: 'runtime_constraint';
  constraintKind: ModelInputRuntimeConstraintKind;
  text: string;
}

export const MODEL_INPUT_MEMORY_PART_KINDS = ['memory_recall'] as const;
export const ModelInputMemoryPartKindSchema = z.enum(MODEL_INPUT_MEMORY_PART_KINDS);
export type ModelInputMemoryPartKind = (typeof MODEL_INPUT_MEMORY_PART_KINDS)[number];

export const MemoryPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('memory'),
  memoryKind: ModelInputMemoryPartKindSchema,
  text: NonEmptyTextSchema,
  memoryIds: z.array(IdSchema).optional(),
}).strict();

export interface MemoryPart extends ModelInputContextPartBase {
  kind: 'memory';
  memoryKind: ModelInputMemoryPartKind;
  text: string;
  memoryIds?: string[];
}

export const ModelInputContextPartSchema = z.discriminatedUnion('kind', [
  InstructionPartSchema,
  CurrentTurnPartSchema,
  SessionPartSchema,
  ToolContinuationPartSchema,
  RuntimeConstraintPartSchema,
  MemoryPartSchema,
]);

export type ModelInputContextPart =
  | InstructionPart
  | CurrentTurnPart
  | SessionPart
  | ToolContinuationPart
  | RuntimeConstraintPart
  | MemoryPart;

export const ModelInputContextPartBudgetSchema = z
  .object({
    partId: IdSchema,
    tokenEstimate: z.number().int().nonnegative(),
    budgetStatus: z.enum(MODEL_INPUT_CONTEXT_BUDGET_STATUSES),
  })
  .strict();

export interface ModelInputContextPartBudget {
  partId: string;
  tokenEstimate: number;
  budgetStatus: ModelInputContextBudgetStatus;
}

export const ModelInputContextBudgetSchema = z
  .object({
    modelContextWindow: z.number().int().positive(),
    reservedOutputTokens: z.number().int().nonnegative(),
    availableInputTokens: z.number().int().nonnegative(),
    keepRecentTokens: z.number().int().nonnegative(),
    inputTokenEstimate: z.number().int().nonnegative(),
    partBudgets: z.array(ModelInputContextPartBudgetSchema),
  })
  .strict();

export interface ModelInputContextBudget {
  modelContextWindow: number;
  reservedOutputTokens: number;
  availableInputTokens: number;
  keepRecentTokens: number;
  inputTokenEstimate: number;
  partBudgets: ModelInputContextPartBudget[];
}

export const ModelInputContextSelectedSourceSchema = z
  .object({
    sourceId: IdSchema,
    reason: z.string().min(1),
    sourceKind: z.enum(MODEL_INPUT_CONTEXT_SOURCE_KINDS).optional(),
    budgetClass: ModelInputContextBudgetClassSchema.optional(),
    partId: IdSchema.optional(),
  })
  .strict();

export interface ModelInputContextSelectedSource {
  sourceId: string;
  reason: string;
  sourceKind?: ModelInputContextSourceKind;
  budgetClass?: ModelInputContextBudgetClass;
  partId?: string;
}

export const ModelInputContextExcludedSourceSchema = z
  .object({
    sourceRef: ModelInputContextSourceRefSchema,
    reason: z.string().min(1),
    budgetClass: ModelInputContextBudgetClassSchema.optional(),
    partId: IdSchema.optional(),
  })
  .strict();

export interface ModelInputContextExcludedSource {
  sourceRef: ModelInputContextSourceRef;
  reason: string;
  budgetClass?: ModelInputContextBudgetClass;
  partId?: string;
}

export const ModelInputContextTraceSchema = z
  .object({
    buildReason: z.string().min(1),
    selectedSources: z.array(ModelInputContextSelectedSourceSchema),
    excludedSources: z.array(ModelInputContextExcludedSourceSchema),
    firstKeptPartId: IdSchema.optional(),
    firstKeptSourceId: IdSchema.optional(),
    budgetWarnings: z.array(ContextBudgetWarningSchema).optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ModelInputContextTrace {
  buildReason: string;
  selectedSources: ModelInputContextSelectedSource[];
  excludedSources: ModelInputContextExcludedSource[];
  firstKeptPartId?: string;
  firstKeptSourceId?: string;
  budgetWarnings?: ContextBudgetWarning[];
  metadata?: JsonObject;
}

const ModelInputContextBuildCurrentTurnSchema = z
  .object({
    messageId: IdSchema.optional(),
    effectiveUserText: NonEmptyTextSchema.optional(),
    inputPreprocessingRef: IdSchema.optional(),
  })
  .strict();

const ModelInputContextBuildActivePathSchema = z
  .object({
    activeLeafId: IdSchema.optional(),
    branchId: IdSchema.optional(),
  })
  .strict();

const ModelInputContextBuildModelTargetSchema = z
  .object({
    providerId: IdSchema,
    modelId: IdSchema,
    contextWindow: z.number().int().positive().optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

const ModelInputContextBuildRuntimeFactSchema = z
  .object({
    factId: IdSchema,
    factKind: IdSchema,
    text: NonEmptyTextSchema,
    required: z.boolean().optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

const ModelInputContextBuildMemoryRecallSeedSchema = z
  .object({
    queryText: NonEmptyTextSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export const ModelInputContextBuildRequestSchema = z
  .object({
    requestId: IdSchema,
    contextId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema,
    modelStepId: IdSchema,
    projectId: IdSchema.optional(),
    projectRoot: NonEmptyTextSchema.optional(),
    effectiveCwd: NonEmptyTextSchema.optional(),
    permissionMode: IdSchema.optional(),
    permissionSnapshotRef: IdSchema.optional(),
    currentTurn: ModelInputContextBuildCurrentTurnSchema.optional(),
    activePath: ModelInputContextBuildActivePathSchema.optional(),
    modelTarget: ModelInputContextBuildModelTargetSchema,
    availableToolsRef: IdSchema.optional(),
    availableCapabilitySummary: NonEmptyTextSchema.optional(),
    runtimeFacts: z.array(ModelInputContextBuildRuntimeFactSchema).default([]),
    memoryRecallSeed: ModelInputContextBuildMemoryRecallSeedSchema.optional(),
    traceId: IdSchema,
    builtAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type ModelInputContextBuildRequest = z.infer<typeof ModelInputContextBuildRequestSchema>;

export const ModelInputContextSchema = z
  .object({
    contextId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    parts: z.array(ModelInputContextPartSchema),
    budget: ModelInputContextBudgetSchema,
    trace: ModelInputContextTraceSchema,
    builtAt: IsoDateTimeSchema,
  })
  .strict();

export interface ModelInputContext {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  parts: ModelInputContextPart[];
  budget: ModelInputContextBudget;
  trace: ModelInputContextTrace;
  builtAt: IsoDateTime;
}

