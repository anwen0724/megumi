import { AgentRunModeRepository } from '@megumi/db/repos/agent-run-mode.repo';
import {
  RUN_MODE_PRESET_DEFAULTS,
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type RunMode,
  type RunModeSnapshot,
  type RunSourcePlanRelation,
} from '@megumi/shared/agent-run-mode-contracts';

export interface AgentRunModeServiceIds {
  modeSnapshotId(): string;
  planArtifactId(): string;
}

export interface AgentRunModeServiceOptions {
  repository: Pick<
    AgentRunModeRepository,
    | 'saveModeSnapshot'
    | 'saveImplementationPlan'
    | 'getImplementationPlan'
    | 'getImplementationPlanByProducingRun'
    | 'updateImplementationPlanStatus'
    | 'saveSourcePlanRelation'
  >;
  ids?: AgentRunModeServiceIds;
}

const defaultIds: AgentRunModeServiceIds = {
  modeSnapshotId: () => `mode-snapshot:${crypto.randomUUID()}`,
  planArtifactId: () => `plan:${crypto.randomUUID()}`,
};

export class AgentRunModeService {
  private readonly ids: AgentRunModeServiceIds;

  constructor(private readonly options: AgentRunModeServiceOptions) {
    this.ids = options.ids ?? defaultIds;
  }

  createModeSnapshot(input: {
    runId: string;
    mode: string;
    modeSnapshot?: RunMode;
    createdAt: string;
  }): RunModeSnapshot {
    const mode = input.modeSnapshot ?? resolvePresetMode(input.mode);
    const snapshot: RunModeSnapshot = {
      modeSnapshotId: this.ids.modeSnapshotId(),
      runId: input.runId,
      modeLabel: mode.preset ?? input.mode,
      mode,
      createdAt: input.createdAt,
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
    if (input.mode.outputExpectation !== 'implementation_plan_artifact') {
      return undefined;
    }

    return this.options.repository.saveImplementationPlan({
      planArtifactId: this.ids.planArtifactId(),
      producingRunId: input.runId,
      title: input.goal,
      status: 'proposed',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      metadata: {
        artifactKind: 'implementation_plan',
        modePreset: input.mode.preset ?? 'plan',
      },
    });
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

    return plan;
  }
}

function resolvePresetMode(mode: string): RunMode {
  if (mode in RUN_MODE_PRESET_DEFAULTS) {
    return RUN_MODE_PRESET_DEFAULTS[mode as keyof typeof RUN_MODE_PRESET_DEFAULTS];
  }

  return {
    preset: mode,
    taskIntent: 'answer',
    permissionMode: 'default',
    outputExpectation: 'assistant_message',
    selectionSource: 'host_inference',
  };
}
