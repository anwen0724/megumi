import { describe, expect, it, vi } from 'vitest';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/agent-run-mode-contracts';
import { AgentRunModeService } from '@megumi/desktop/main/services/agent-run-mode.service';

function createRepo() {
  const snapshots: unknown[] = [];
  const plans = new Map<string, any>();
  const relations: unknown[] = [];
  return {
    snapshots,
    plans,
    relations,
    saveModeSnapshot: (snapshot: any) => {
      snapshots.push(snapshot);
      return snapshot;
    },
    saveImplementationPlan: (plan: any) => {
      plans.set(plan.planArtifactId, plan);
      return plan;
    },
    getImplementationPlan: (planArtifactId: string) => plans.get(planArtifactId),
    getImplementationPlanByProducingRun: (runId: string) =>
      [...plans.values()].find((plan) => plan.producingRunId === runId),
    updateImplementationPlanStatus: (input: any) => {
      const plan = plans.get(input.planArtifactId);
      const updated = {
        ...plan,
        status: input.status,
        updatedAt: input.updatedAt,
        ...(input.status === 'accepted' ? { acceptedAt: input.updatedAt } : {}),
      };
      plans.set(input.planArtifactId, updated);
      return updated;
    },
    saveSourcePlanRelation: (relation: any) => {
      relations.push(relation);
      return relation;
    },
  };
}

describe('AgentRunModeService', () => {
  it('creates a mode snapshot using explicit payload mode', () => {
    const repo = createRepo();
    const service = new AgentRunModeService({
      repository: repo,
      ids: { modeSnapshotId: () => 'mode-snapshot:1', planArtifactId: () => 'plan:1' },
    });

    const snapshot = service.createModeSnapshot({
      runId: 'run:1',
      mode: 'execute',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.execute,
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(snapshot.modeSnapshotId).toBe('mode-snapshot:1');
    expect(snapshot.modeLabel).toBe('execute');
    expect(snapshot.mode.permissionMode).toBe('default');
  });

  it('rejects source plans that are not accepted', () => {
    const repo = createRepo();
    repo.saveImplementationPlan({
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    const service = new AgentRunModeService({
      repository: repo,
      ids: { modeSnapshotId: () => 'mode-snapshot:1', planArtifactId: () => 'plan:1' },
    });

    expect(() => service.linkAcceptedSourcePlan({
      runId: 'run:execute',
      sourcePlanId: 'plan:1',
      linkedAt: '2026-05-15T00:00:01.000Z',
    })).toThrow('Only accepted implementation plans can be used as sourcePlanId.');
  });

  it('creates proposed plan records for plan output runs', () => {
    const repo = createRepo();
    const service = new AgentRunModeService({
      repository: repo,
      ids: { modeSnapshotId: () => 'mode-snapshot:1', planArtifactId: () => 'plan:created' },
    });

    const plan = service.createPlanRecordForRun({
      runId: 'run:plan',
      goal: 'Write plan',
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(plan?.planArtifactId).toBe('plan:created');
    expect(plan?.status).toBe('proposed');
  });

  it('syncs created implementation plans into generic artifact compatibility service', () => {
    const repo = createRepo();
    const planArtifactCompatibility = {
      syncImplementationPlanArtifact: vi.fn(),
    };
    const service = new AgentRunModeService({
      repository: repo,
      planArtifactCompatibility,
      ids: {
        modeSnapshotId: () => 'mode-snapshot:1',
        planArtifactId: () => 'plan:1',
      },
    });

    const plan = service.createPlanRecordForRun({
      runId: 'run:1',
      goal: 'Write plans',
      mode: {
        taskIntent: 'plan',
        permissionMode: 'plan',
        outputExpectation: 'implementation_plan_artifact',
      },
      createdAt: '2026-05-16T00:00:00.000Z',
    });

    expect(planArtifactCompatibility.syncImplementationPlanArtifact).toHaveBeenCalledWith(plan);
  });

  it('syncs plan status updates into generic artifact compatibility service', () => {
    const repo = createRepo();
    const planArtifactCompatibility = {
      syncImplementationPlanArtifact: vi.fn(),
    };
    const service = new AgentRunModeService({
      repository: repo,
      planArtifactCompatibility,
      ids: {
        modeSnapshotId: () => 'mode-snapshot:1',
        planArtifactId: () => 'plan:1',
      },
    });

    service.createPlanRecordForRun({
      runId: 'run:1',
      goal: 'Write plans',
      mode: {
        taskIntent: 'plan',
        permissionMode: 'plan',
        outputExpectation: 'implementation_plan_artifact',
      },
      createdAt: '2026-05-16T00:00:00.000Z',
    });
    planArtifactCompatibility.syncImplementationPlanArtifact.mockClear();

    const plan = service.updatePlanStatus({
      planArtifactId: 'plan:1',
      status: 'accepted',
      updatedAt: '2026-05-16T00:00:01.000Z',
    });

    expect(planArtifactCompatibility.syncImplementationPlanArtifact).toHaveBeenCalledWith(plan);
  });
});
