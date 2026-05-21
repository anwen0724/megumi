import { z } from 'zod';
import type { IsoDateTime, RunId } from './ids';
import { JsonObjectSchema, type JsonObject } from './json';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeSnapshotSchema,
  PermissionModeSelectionSourceSchema,
  type PermissionMode,
  type PermissionModeSnapshot,
  type PermissionModeSelectionSource,
  isPermissionMode,
} from './permission-mode-contracts';
import { IsoDateTimeSchema } from './runtime-validation';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeSnapshotSchema,
  PermissionModeSelectionSourceSchema,
  isPermissionMode,
};

export type {
  PermissionMode,
  PermissionModeSnapshot,
  PermissionModeSelectionSource,
};

export interface RunMode {
  permissionMode: PermissionMode;
  source?: PermissionModeSelectionSource;
}

export interface RunModeSnapshot {
  modeSnapshotId: string;
  runId: RunId | string;
  mode: RunMode;
  modeLabel: string;
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

export const RunModeSchema = z
  .object({
    permissionMode: PermissionModeSchema,
    source: PermissionModeSelectionSourceSchema.optional(),
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

export function toPermissionModeSnapshot(input: {
  permissionMode: PermissionMode;
  source?: PermissionModeSelectionSource;
  createdAt: string;
}): PermissionModeSnapshot {
  return PermissionModeSnapshotSchema.parse({
    permissionMode: input.permissionMode,
    source: input.source ?? 'system',
    createdAt: input.createdAt,
  });
}
