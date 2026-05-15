import { z } from 'zod';
import type { IsoDateTime, RunId } from './ids';
import { JsonObjectSchema, type JsonObject } from './json';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const RUN_MODE_PRESETS = ['chat', 'plan', 'execute', 'review'] as const;
export type InitialRunModePreset = (typeof RUN_MODE_PRESETS)[number];

export const TASK_INTENTS = ['answer', 'explore', 'plan', 'work', 'review'] as const;
export type TaskIntent = (typeof TASK_INTENTS)[number];

export const PERMISSION_MODES = [
  'default',
  'plan',
  'accept_edits',
  'auto',
  'bypass_permissions',
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const ACTIVE_PERMISSION_MODES = ['default', 'plan'] as const;
export type ActivePermissionMode = (typeof ACTIVE_PERMISSION_MODES)[number];

export const OUTPUT_EXPECTATIONS = [
  'assistant_message',
  'implementation_plan_artifact',
  'review_findings',
  'execution_result',
] as const;
export type OutputExpectation = (typeof OUTPUT_EXPECTATIONS)[number];

export const RUN_MODE_SELECTION_SOURCES = [
  'user_selected',
  'default_setting',
  'command',
  'host_inference',
  'user_confirmation',
] as const;
export type RunModeSelectionSource = (typeof RUN_MODE_SELECTION_SOURCES)[number];

export const IMPLEMENTATION_PLAN_ARTIFACT_STATUSES = [
  'draft',
  'proposed',
  'accepted',
  'rejected',
  'superseded',
] as const;
export type ImplementationPlanArtifactStatus =
  (typeof IMPLEMENTATION_PLAN_ARTIFACT_STATUSES)[number];

export interface RunMode {
  preset?: string;
  taskIntent: TaskIntent;
  permissionMode: PermissionMode;
  outputExpectation: OutputExpectation;
  reason?: string;
  selectionSource?: RunModeSelectionSource;
}

export interface RunModeSnapshot {
  modeSnapshotId: string;
  runId: RunId | string;
  mode: RunMode;
  modeLabel: string;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export interface ImplementationPlanArtifactRecord {
  planArtifactId: string;
  producingRunId: RunId | string;
  title: string;
  status: ImplementationPlanArtifactStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  acceptedAt?: IsoDateTime;
  rejectedAt?: IsoDateTime;
  supersededAt?: IsoDateTime;
  supersededByPlanId?: string;
  metadata?: JsonObject;
}

export interface RunSourcePlanRelation {
  runId: RunId | string;
  sourcePlanId: string;
  linkedAt: IsoDateTime;
  metadata?: JsonObject;
}

export const InitialRunModePresetSchema = z.enum(RUN_MODE_PRESETS);
export const TaskIntentSchema = z.enum(TASK_INTENTS);
export const PermissionModeSchema = z.enum(PERMISSION_MODES);
export const ActivePermissionModeSchema = z.enum(ACTIVE_PERMISSION_MODES);
export const OutputExpectationSchema = z.enum(OUTPUT_EXPECTATIONS);
export const RunModeSelectionSourceSchema = z.enum(RUN_MODE_SELECTION_SOURCES);
export const ImplementationPlanArtifactStatusSchema = z.enum(
  IMPLEMENTATION_PLAN_ARTIFACT_STATUSES,
);

export const RunModeSchema = z
  .object({
    preset: z.string().min(1).optional(),
    taskIntent: TaskIntentSchema,
    permissionMode: PermissionModeSchema,
    outputExpectation: OutputExpectationSchema,
    reason: z.string().min(1).optional(),
    selectionSource: RunModeSelectionSourceSchema.optional(),
  })
  .strict() satisfies z.ZodType<RunMode>;

export const RunModeSnapshotSchema = z
  .object({
    modeSnapshotId: IdSchema,
    runId: IdSchema,
    mode: RunModeSchema,
    modeLabel: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<RunModeSnapshot>;

export const ImplementationPlanArtifactRecordSchema = z
  .object({
    planArtifactId: IdSchema,
    producingRunId: IdSchema,
    title: z.string().min(1),
    status: ImplementationPlanArtifactStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema.optional(),
    rejectedAt: IsoDateTimeSchema.optional(),
    supersededAt: IsoDateTimeSchema.optional(),
    supersededByPlanId: IdSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<ImplementationPlanArtifactRecord>;

export const RunSourcePlanRelationSchema = z
  .object({
    runId: IdSchema,
    sourcePlanId: IdSchema,
    linkedAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<RunSourcePlanRelation>;

export const RUN_MODE_PRESET_DEFAULTS = {
  chat: {
    preset: 'chat',
    taskIntent: 'answer',
    permissionMode: 'default',
    outputExpectation: 'assistant_message',
    selectionSource: 'default_setting',
  },
  plan: {
    preset: 'plan',
    taskIntent: 'plan',
    permissionMode: 'plan',
    outputExpectation: 'implementation_plan_artifact',
    selectionSource: 'default_setting',
  },
  execute: {
    preset: 'execute',
    taskIntent: 'work',
    permissionMode: 'default',
    outputExpectation: 'execution_result',
    selectionSource: 'default_setting',
  },
  review: {
    preset: 'review',
    taskIntent: 'review',
    permissionMode: 'plan',
    outputExpectation: 'review_findings',
    selectionSource: 'default_setting',
  },
} as const satisfies Record<InitialRunModePreset, RunMode>;

export function isActivePermissionMode(value: PermissionMode): value is ActivePermissionMode {
  return (ACTIVE_PERMISSION_MODES as readonly string[]).includes(value);
}
