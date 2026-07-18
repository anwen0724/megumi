// Owns implementation plan artifact creation and status updates for Agent runs.
import type {
  PlanStatusUpdatePayload,
  PlanStatusUpdateRepositoryPayload,
} from './legacy-contracts/plan-artifact-contracts';
import type {
  ImplementationPlanArtifactRecord,
  PermissionModeState,
} from './legacy-contracts/plan-artifact-contracts';


export interface PlanArtifactCompatibility {
  syncImplementationPlanArtifact(plan: ImplementationPlanArtifactRecord): void;
}

export interface PlanArtifactServiceIds {
  planArtifactId(): string;
}

export interface PlanArtifactServicePort {
  createPlanRecordForRun(input: {
    runId: string;
    goal: string;
    permissionModeState: PermissionModeState;
    createdAt: string;
  }): ImplementationPlanArtifactRecord | undefined;
  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined;
  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord;
}

export interface PlanArtifactRepositoryPort {
  saveImplementationPlan(plan: ImplementationPlanArtifactRecord): ImplementationPlanArtifactRecord;
  getImplementationPlanByProducingRun(runId: string): ImplementationPlanArtifactRecord | undefined;
  updateImplementationPlanStatus(input: PlanStatusUpdateRepositoryPayload): ImplementationPlanArtifactRecord | undefined;
}

export interface PlanArtifactServiceOptions {
  repository: PlanArtifactRepositoryPort;
  planArtifactCompatibility?: PlanArtifactCompatibility;
  ids?: PlanArtifactServiceIds;
  now?: () => string;
}

const defaultIds: PlanArtifactServiceIds = {
  planArtifactId: () => `plan:${crypto.randomUUID()}`,
};

export class PlanArtifactService implements PlanArtifactServicePort {
  private readonly ids: PlanArtifactServiceIds;

  constructor(private readonly options: PlanArtifactServiceOptions) {
    this.ids = options.ids ?? defaultIds;
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

  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord {
    const plan = this.options.repository.updateImplementationPlanStatus({
      ...input,
      updatedAt: this.now(),
    });

    if (!plan) {
      throw new Error('Implementation plan was not found.');
    }

    this.options.planArtifactCompatibility?.syncImplementationPlanArtifact(plan);
    return plan;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}
