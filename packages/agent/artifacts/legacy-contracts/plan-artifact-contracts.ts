/*
 * Legacy plan artifact contracts kept inside the artifacts module until artifacts is refactored.
 * No other module may import this file.
 */
import { z } from 'zod';
import type { JsonObject } from './artifact-json';
type IsoDateTime = string;
type RunId = string;
import { JsonObjectSchema } from './artifact-json';
import {
  ARTIFACT_EXECUTION_INTENTS,
  ArtifactExecutionIntentSchema,
  ExecutionIntentSnapshotSchema,
  ExecutionIntentSelectionSourceSchema,
  type ArtifactExecutionIntent,
  type ExecutionIntentSnapshot,
  type ExecutionIntentSelectionSource,
  isArtifactExecutionIntent,
} from './execution-intent-contracts';
import { IsoDateTimeSchema } from './artifact-json';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export {
  ARTIFACT_EXECUTION_INTENTS,
  ArtifactExecutionIntentSchema,
  ExecutionIntentSnapshotSchema,
  ExecutionIntentSelectionSourceSchema,
  isArtifactExecutionIntent,
};

export type {
  ArtifactExecutionIntent,
  ExecutionIntentSnapshot,
  ExecutionIntentSelectionSource,
};

export interface ExecutionIntentState {
  executionIntent: ArtifactExecutionIntent;
  source?: ExecutionIntentSelectionSource;
}

export interface PermissionSnapshotRecord {
  permissionSnapshotId: string;
  runId: RunId | string;
  executionIntentState: ExecutionIntentState;
  permissionLabel: string;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export const IMPLEMENTATION_PLAN_ARTIFACT_STATUSES = [
  'draft',
  'proposed',
  'accepted',
  'rejected',
  'superseded',
] as const;
export type ImplementationPlanArtifactStatus =
  (typeof IMPLEMENTATION_PLAN_ARTIFACT_STATUSES)[number];

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

export const ExecutionIntentStateSchema = z
  .object({
    executionIntent: ArtifactExecutionIntentSchema,
    source: ExecutionIntentSelectionSourceSchema.optional(),
  })
  .strict() satisfies z.ZodType<ExecutionIntentState>;

export const PermissionSnapshotRecordSchema = z
  .object({
    permissionSnapshotId: IdSchema,
    runId: IdSchema,
    executionIntentState: ExecutionIntentStateSchema,
    permissionLabel: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<PermissionSnapshotRecord>;

export const ImplementationPlanArtifactStatusSchema = z.enum(
  IMPLEMENTATION_PLAN_ARTIFACT_STATUSES,
);

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

export function toExecutionIntentSnapshot(input: {
  executionIntent: ArtifactExecutionIntent;
  source?: ExecutionIntentSelectionSource;
  createdAt: string;
}): ExecutionIntentSnapshot {
  return ExecutionIntentSnapshotSchema.parse({
    executionIntent: input.executionIntent,
    source: input.source ?? 'system',
    createdAt: input.createdAt,
  });
}



export interface PlanStatusUpdateIntent {
  planArtifactId: string;
  status: ImplementationPlanArtifactStatus;
  supersededByPlanId?: string;
}

export type PlanStatusUpdatePayload = PlanStatusUpdateIntent;

export interface PlanStatusUpdateRepositoryPayload extends PlanStatusUpdateIntent {
  updatedAt: string;
}
