import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import {
  PermissionModeSchema,
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type RunMode,
  type RunModeSnapshot,
  type RunSourcePlanRelation,
} from '@megumi/shared/run-mode-contracts';

export interface RunModeServiceIds {
  modeSnapshotId(): string;
  planArtifactId(): string;
}

export interface PlanArtifactCompatibility {
  syncImplementationPlanArtifact(plan: ImplementationPlanArtifactRecord): void;
}

export interface RunModeServiceOptions {
  repository: Pick<
    RunModeRepository,
    | 'saveModeSnapshot'
    | 'saveImplementationPlan'
    | 'getImplementationPlan'
    | 'getImplementationPlanByProducingRun'
    | 'updateImplementationPlanStatus'
    | 'saveSourcePlanRelation'
  >;
  planArtifactCompatibility?: PlanArtifactCompatibility;
  ids?: RunModeServiceIds;
}

const defaultIds: RunModeServiceIds = {
  modeSnapshotId: () => `mode-snapshot:${crypto.randomUUID()}`,
  planArtifactId: () => `plan:${crypto.randomUUID()}`,
};

export class RunModeService {
  private readonly ids: RunModeServiceIds;

  constructor(private readonly options: RunModeServiceOptions) {
    this.ids = options.ids ?? defaultIds;
  }

  createModeSnapshot(input: {
    runId: string;
    mode: string;
    modeSnapshot?: RunMode;
    metadata?: RunModeSnapshot['metadata'];
    createdAt: string;
  }): RunModeSnapshot {
    const mode = normalizeRunMode(input.modeSnapshot ?? input.mode);
    const snapshot: RunModeSnapshot = {
      modeSnapshotId: this.ids.modeSnapshotId(),
      runId: input.runId,
      modeLabel: mode.permissionMode,
      mode,
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    return this.options.repository.saveModeSnapshot(snapshot);
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
    mode: RunMode;
    createdAt: string;
  }): ImplementationPlanArtifactRecord | undefined {
    if (input.mode.permissionMode !== 'plan') {
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
        permissionMode: input.mode.permissionMode,
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

function normalizeRunMode(input: RunMode | string): RunMode {
  if (typeof input === 'string') {
    return {
      permissionMode: PermissionModeSchema.parse(input),
      source: 'system',
    };
  }

  return {
    permissionMode: PermissionModeSchema.parse(input.permissionMode),
    ...(input.source ? { source: input.source } : {}),
  };
}
