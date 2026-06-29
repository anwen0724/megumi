// Provides the permissions-owned entrypoint for run permission snapshots.
import type {
  PermissionMode,
  PermissionModeSelectionSource,
  PermissionModeState,
  PermissionSnapshotRecord,
  RunSourcePlanRelation,
} from '@megumi/shared/permission';
import { PermissionModeStateSchema } from '@megumi/shared/permission';

export interface RunPermissionSnapshotServicePort {
  createPermissionSnapshot(input: {
    runId: string;
    permissionMode: string;
    permissionModeState?: PermissionModeState;
    metadata?: PermissionSnapshotRecord['metadata'];
    createdAt: string;
  }): PermissionSnapshotRecord;
  linkAcceptedSourcePlan(input: RunSourcePlanRelation): RunSourcePlanRelation;
}

export interface CreateRunPermissionSnapshotInput {
  service?: RunPermissionSnapshotServicePort;
  runId: string;
  permissionMode: PermissionMode | string;
  permissionModeState?: PermissionModeState;
  permissionSource?: PermissionModeSelectionSource;
  metadata?: PermissionSnapshotRecord['metadata'];
  sourcePlanId?: string;
  createdAt: string;
}

export interface RunPermissionSnapshotResult {
  record: PermissionSnapshotRecord;
  permissionSnapshotRef: string;
  permissionModeState: PermissionModeState;
}

export function createRunPermissionSnapshot(
  input: CreateRunPermissionSnapshotInput,
): RunPermissionSnapshotResult | undefined {
  if (!input.service) {
    return undefined;
  }

  const record = input.service.createPermissionSnapshot({
    runId: input.runId,
    permissionMode: input.permissionMode,
    ...(input.permissionModeState || input.permissionSource ? {
      permissionModeState: input.permissionModeState ?? {
        permissionMode: PermissionModeStateSchema.shape.permissionMode.parse(input.permissionMode),
        source: input.permissionSource ?? 'system',
      },
    } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.createdAt,
  });

  if (input.sourcePlanId) {
    input.service.linkAcceptedSourcePlan({
      runId: input.runId,
      sourcePlanId: input.sourcePlanId,
      linkedAt: input.createdAt,
    });
  }

  return {
    record,
    permissionSnapshotRef: record.permissionSnapshotId,
    permissionModeState: record.permissionModeState,
  };
}
