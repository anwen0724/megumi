import {
  ACTIVE_PERMISSION_MODES,
  IMPLEMENTATION_PLAN_ARTIFACT_STATUSES,
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
  PermissionModeSchema,
  PermissionModeSelectionSourceSchema,
  PermissionModeSnapshotSchema,
  PermissionModeStateSchema,
  PermissionSnapshotRecordSchema,
  RunSourcePlanRelationSchema,
  isPermissionMode,
  toPermissionModeSnapshot,
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type PermissionMode,
  type PermissionModeSelectionSource,
  type PermissionModeSnapshot,
  type PermissionModeState,
  type PermissionSnapshotRecord,
  type RunSourcePlanRelation,
} from './permission-snapshot-contracts';

export {
  ACTIVE_PERMISSION_MODES,
  IMPLEMENTATION_PLAN_ARTIFACT_STATUSES,
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
  PermissionModeSchema,
  PermissionModeSelectionSourceSchema,
  PermissionModeSnapshotSchema,
  PermissionModeStateSchema,
  PermissionSnapshotRecordSchema,
  RunSourcePlanRelationSchema,
  isPermissionMode,
  toPermissionModeSnapshot,
};

export type {
  ImplementationPlanArtifactRecord,
  ImplementationPlanArtifactStatus,
  PermissionMode,
  PermissionModeSelectionSource,
  PermissionModeSnapshot,
  PermissionModeState,
  PermissionSnapshotRecord,
  RunSourcePlanRelation,
};

/**
 * Compatibility alias only. New code must import PermissionModeState.
 */
export type RunMode = PermissionModeState;

/**
 * Compatibility alias only. New code must import PermissionSnapshotRecord.
 */
export type RunModeSnapshot = PermissionSnapshotRecord;

export const RunModeSchema = PermissionModeStateSchema;
export const RunModeSnapshotSchema = PermissionSnapshotRecordSchema;
