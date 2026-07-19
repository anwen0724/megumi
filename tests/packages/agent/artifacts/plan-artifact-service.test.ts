import { describe, expect, it, vi } from 'vitest';
import { PlanArtifactService } from '@megumi/agent/artifacts';

function createRepository() {
  const plans: any[] = [];

  return {
    saveImplementationPlan: vi.fn((plan: any) => {
      plans.push(plan);
      return plan;
    }),
    getImplementationPlanByProducingRun: vi.fn((runId: string) =>
      plans.find((plan) => plan.producingRunId === runId)),
    updateImplementationPlanStatus: vi.fn((input: any) => {
      const plan = plans.find((item) => item.planArtifactId === input.planArtifactId);
      if (!plan) {
        return undefined;
      }
      Object.assign(plan, {
        status: input.status,
        updatedAt: input.updatedAt,
        ...(input.status === 'accepted' ? { acceptedAt: input.updatedAt } : {}),
        ...(input.supersededByPlanId ? { supersededByPlanId: input.supersededByPlanId } : {}),
      });
      return plan;
    }),
  };
}

describe('PlanArtifactService', () => {
  it('creates plan records only for plan permission mode state', () => {
    const repository = createRepository();
    const service = new PlanArtifactService({
      repository,
      ids: { planArtifactId: () => 'plan:1' },
    });

    expect(service.createPlanRecordForRun({
      runId: 'run:1',
      goal: 'Write a plan',
      executionIntentState: {
        executionIntent: 'plan',
        source: 'user',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    })).toMatchObject({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      status: 'proposed',
    });

    expect(service.createPlanRecordForRun({
      runId: 'run:2',
      goal: 'Do work',
      executionIntentState: {
        executionIntent: 'default',
        source: 'user',
      },
      createdAt: '2026-06-11T00:00:01.000Z',
    })).toBeUndefined();
  });

  it('gets and updates plan status through the artifact service', () => {
    const repository = createRepository();
    const compatibility = { syncImplementationPlanArtifact: vi.fn() };
    const service = new PlanArtifactService({
      repository,
      planArtifactCompatibility: compatibility,
      ids: { planArtifactId: () => 'plan:1' },
      now: () => '2026-06-11T00:01:00.000Z',
    });

    service.createPlanRecordForRun({
      runId: 'run:1',
      goal: 'Write a plan',
      executionIntentState: {
        executionIntent: 'plan',
        source: 'user',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    });

    expect(service.getPlanByRun('run:1')).toMatchObject({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
    });

    expect(service.updatePlanStatus({
      planArtifactId: 'plan:1',
      status: 'accepted',
    })).toMatchObject({
      planArtifactId: 'plan:1',
      status: 'accepted',
      acceptedAt: '2026-06-11T00:01:00.000Z',
      updatedAt: '2026-06-11T00:01:00.000Z',
    });
    expect(compatibility.syncImplementationPlanArtifact).toHaveBeenCalledTimes(2);
  });
});
