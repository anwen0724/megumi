import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';
import {
  PermissionModeStateSchema,
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type PermissionModeState,
  type PermissionSnapshotRecord,
  type RunSourcePlanRelation,
} from '@megumi/shared/permission-snapshot-contracts';

export interface PermissionSnapshotServiceIds {
  permissionSnapshotId(): string;
  planArtifactId(): string;
}

export interface PlanArtifactCompatibility {
  syncImplementationPlanArtifact(plan: ImplementationPlanArtifactRecord): void;
}

export interface PermissionSnapshotServiceOptions {
  repository: Pick<
    PermissionSnapshotRepository,
    | 'savePermissionSnapshot'
    | 'saveImplementationPlan'
    | 'getImplementationPlan'
    | 'getImplementationPlanByProducingRun'
    | 'updateImplementationPlanStatus'
    | 'saveSourcePlanRelation'
  >;
  planArtifactCompatibility?: PlanArtifactCompatibility;
  ids?: PermissionSnapshotServiceIds;
}

const defaultIds: PermissionSnapshotServiceIds = {
  permissionSnapshotId: () => `permission-snapshot:${crypto.randomUUID()}`,
  planArtifactId: () => `plan:${crypto.randomUUID()}`,
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

  createPlanRecordForRun(input: {
    runId: string;
    goal: string;
    permissionModeState: PermissionModeState;
    createdAt: string;
  }): ImplementationPlanArtifactRecord | undefined {
    if (input.permissionModeState.permissionMode !== 'plan') {
      return undefined;
    }

    const plan = this.options.repository.saveImplementationPlan({
      planArtifactId: this.ids.planArtifactId(),
      producingRunId: input.runId,
      title: input.goal,
      status: 'proposed',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      metadata: {
        artifactKind: 'implementation_plan',
        permissionMode: input.permissionModeState.permissionMode,
      },
    });

    this.options.planArtifactCompatibility?.syncImplementationPlanArtifact(plan);
    return plan;
  }

  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return this.options.repository.getImplementationPlanByProducingRun(runId);
  }

  updatePlanStatus(input: {
    planArtifactId: string;
    status: ImplementationPlanArtifactStatus;
    updatedAt: string;
    supersededByPlanId?: string;
  }): ImplementationPlanArtifactRecord {
    const plan = this.options.repository.updateImplementationPlanStatus(input);

    if (!plan) {
      throw new Error('Implementation plan was not found.');
    }

    this.options.planArtifactCompatibility?.syncImplementationPlanArtifact(plan);
    return plan;
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
