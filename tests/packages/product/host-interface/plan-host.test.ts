import { describe, expect, it, vi } from 'vitest';
import { createPlanHost } from '@megumi/product/host-interface/plan-host';

describe('PlanHost', () => {
  it('projects owner plan records into host DTOs without adding canonical facts', () => {
    const plan = {
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      title: 'Plan',
      status: 'draft' as const,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      metadata: { artifactKind: 'implementation_plan' },
      ownerOnlyField: 'must not cross',
    };
    const acceptedPlan = { ...plan, status: 'accepted' as const, ownerOnlyField: 'must not cross' };
    const host = createPlanHost({
      getPlanByRun: vi.fn(() => plan),
      updatePlanStatus: vi.fn(() => acceptedPlan),
    } as never);

    expect(host.getByRun('run:1')).toEqual({
      plan: {
        planArtifactId: 'plan:1',
        producingRunId: 'run:1',
        title: 'Plan',
        status: 'draft',
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
        metadata: { artifactKind: 'implementation_plan' },
      },
    });
    expect(host.updateStatus({ planArtifactId: 'plan:1', status: 'accepted' })).toEqual({
      plan: {
        planArtifactId: 'plan:1',
        producingRunId: 'run:1',
        title: 'Plan',
        status: 'accepted',
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
        metadata: { artifactKind: 'implementation_plan' },
      },
    });
  });
});
