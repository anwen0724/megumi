import type { PermissionSnapshotRepository } from '@megumi/coding-agent/persistence/repos/permission-snapshot.repo';
import {
  PermissionModeStateSchema,
  type PermissionModeState,
  type PermissionSnapshotRecord,
  type RunSourcePlanRelation,
} from '@megumi/shared/permission';

export interface PermissionSnapshotServiceIds {
  permissionSnapshotId(): string;
}

export interface PermissionSnapshotServiceOptions {
  repository: Pick<
    PermissionSnapshotRepository,
    | 'savePermissionSnapshot'
    | 'getImplementationPlan'
    | 'saveSourcePlanRelation'
  >;
  ids?: PermissionSnapshotServiceIds;
}

const defaultIds: PermissionSnapshotServiceIds = {
  permissionSnapshotId: () => `permission-snapshot:${crypto.randomUUID()}`,
};

export class PermissionSnapshotService {
  private readonly ids: PermissionSnapshotServiceIds;

  constructor(private readonly options: PermissionSnapshotServiceOptions) {
    this.ids = options.ids ?? defaultIds;
  }

  createPermissionSnapshot(input: {
    runId: string;
    permissionMode: string;
    permissionModeState?: PermissionModeState;
    metadata?: PermissionSnapshotRecord['metadata'];
    createdAt: string;
  }): PermissionSnapshotRecord {
    const permissionModeState = normalizePermissionModeState(input.permissionModeState ?? input.permissionMode);
    const snapshot: PermissionSnapshotRecord = {
      permissionSnapshotId: this.ids.permissionSnapshotId(),
      runId: input.runId,
      permissionLabel: permissionModeState.permissionMode,
      permissionModeState,
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    return this.options.repository.savePermissionSnapshot(snapshot);
  }

  linkAcceptedSourcePlan(input: RunSourcePlanRelation): RunSourcePlanRelation {
    const plan = this.options.repository.getImplementationPlan(input.sourcePlanId);

    if (!plan || plan.status !== 'accepted') {
      throw new Error('Only accepted implementation plans can be used as sourcePlanId.');
    }

    return this.options.repository.saveSourcePlanRelation(input);
  }

}

function normalizePermissionModeState(input: PermissionModeState | string): PermissionModeState {
  if (typeof input === 'string') {
    return {
      permissionMode: PermissionModeStateSchema.shape.permissionMode.parse(input),
      source: 'system',
    };
  }

  return PermissionModeStateSchema.parse(input);
}

