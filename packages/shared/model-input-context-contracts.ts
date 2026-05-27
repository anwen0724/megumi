import { z } from 'zod';
import type { IsoDateTime } from './ids';
import { JsonObjectSchema, type JsonObject } from './json';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const NonEmptyTextSchema = z.string().min(1);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const MODEL_INPUT_CONTEXT_PART_KINDS = [
  'instruction',
  'current_turn',
  'session',
  'tool_continuation',
  'runtime_constraint',
] as const;
export type ModelInputContextPartKind = (typeof MODEL_INPUT_CONTEXT_PART_KINDS)[number];

export const MODEL_INPUT_CONTEXT_SOURCE_KINDS = [
  'system_instruction',
  'project_instruction',
  'mode_instruction',
  'current_user_message',
  'run_goal',
  'timeline_message',
  'tool_use',
  'tool_result',
  'provider_state',
  'permission_mode',
  'project_boundary',
  'runtime_constraint',
  'external_resource',
  'other',
] as const;
export type ModelInputContextSourceKind = (typeof MODEL_INPUT_CONTEXT_SOURCE_KINDS)[number];

export const MODEL_INPUT_CONTEXT_BUDGET_STATUSES = [
  'included_full',
  'included_truncated',
  'included_reduced',
] as const;
export type ModelInputContextBudgetStatus = (typeof MODEL_INPUT_CONTEXT_BUDGET_STATUSES)[number];

export const MODEL_INPUT_INSTRUCTION_KINDS = ['system', 'project', 'mode', 'developer', 'user'] as const;
export type ModelInputInstructionKind = (typeof MODEL_INPUT_INSTRUCTION_KINDS)[number];

export const MODEL_INPUT_CURRENT_TURN_ROLES = ['user', 'host'] as const;
export type ModelInputCurrentTurnRole = (typeof MODEL_INPUT_CURRENT_TURN_ROLES)[number];

export const MODEL_INPUT_RUNTIME_CONSTRAINT_KINDS = [
  'permission_mode',
  'project_boundary',
  'sandbox',
  'approval',
  'sensitive_content',
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
  truncation?: ModelInputContextTruncation;
  metadata?: JsonObject;
}

export const InstructionPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('instruction'),
  instructionKind: z.enum(MODEL_INPUT_INSTRUCTION_KINDS),
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
  text: NonEmptyTextSchema,
}).strict();

export interface SessionPart extends ModelInputContextPartBase {
  kind: 'session';
  text: string;
}

export const ToolContinuationPartSchema = ModelInputContextPartBaseSchema.extend({
  kind: z.literal('tool_continuation'),
  text: NonEmptyTextSchema,
  toolUseId: IdSchema.optional(),
  toolResultId: IdSchema.optional(),
  providerStateIds: z.array(IdSchema).optional(),
}).strict();

export interface ToolContinuationPart extends ModelInputContextPartBase {
  kind: 'tool_continuation';
  text: string;
  toolUseId?: string;
  toolResultId?: string;
  providerStateIds?: string[];
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

export const ModelInputContextPartSchema = z.discriminatedUnion('kind', [
  InstructionPartSchema,
  CurrentTurnPartSchema,
  SessionPartSchema,
  ToolContinuationPartSchema,
  RuntimeConstraintPartSchema,
]);

export type ModelInputContextPart =
  | InstructionPart
  | CurrentTurnPart
  | SessionPart
  | ToolContinuationPart
  | RuntimeConstraintPart;

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
    inputTokenEstimate: z.number().int().nonnegative(),
    partBudgets: z.array(ModelInputContextPartBudgetSchema),
  })
  .strict();

export interface ModelInputContextBudget {
  modelContextWindow: number;
  reservedOutputTokens: number;
  availableInputTokens: number;
  inputTokenEstimate: number;
  partBudgets: ModelInputContextPartBudget[];
}

export const ModelInputContextSelectedSourceSchema = z
  .object({
    sourceId: IdSchema,
    reason: z.string().min(1),
  })
  .strict();

export interface ModelInputContextSelectedSource {
  sourceId: string;
  reason: string;
}

export const ModelInputContextExcludedSourceSchema = z
  .object({
    sourceRef: ModelInputContextSourceRefSchema,
    reason: z.string().min(1),
  })
  .strict();

export interface ModelInputContextExcludedSource {
  sourceRef: ModelInputContextSourceRef;
  reason: string;
}

export const ModelInputContextTraceSchema = z
  .object({
    buildReason: z.string().min(1),
    selectedSources: z.array(ModelInputContextSelectedSourceSchema),
    excludedSources: z.array(ModelInputContextExcludedSourceSchema),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ModelInputContextTrace {
  buildReason: string;
  selectedSources: ModelInputContextSelectedSource[];
  excludedSources: ModelInputContextExcludedSource[];
  metadata?: JsonObject;
}

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
