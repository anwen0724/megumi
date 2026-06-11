import { describe, expect, it } from 'vitest';
import { PermissionSnapshotService } from '@megumi/desktop/main/services/permission-snapshot.service';

function createRepository() {
  const snapshots: any[] = [];
  const plans: any[] = [];
  const relations: any[] = [];

  return {
    snapshots,
    plans,
    relations,
    savePermissionSnapshot: (snapshot: any) => {
      snapshots.push(snapshot);
      return snapshot;
    },
    saveImplementationPlan: (plan: any) => {
      plans.push(plan);
      return plan;
    },
    getImplementationPlan: (planArtifactId: string) => plans.find((plan) => plan.planArtifactId === planArtifactId),
    getImplementationPlanByProducingRun: (runId: string) => plans.find((plan) => plan.producingRunId === runId),
    updateImplementationPlanStatus: (input: any) => {
      const plan = plans.find((item) => item.planArtifactId === input.planArtifactId);
      if (!plan) {
        return undefined;
      }
      Object.assign(plan, {
        status: input.status,
        updatedAt: input.updatedAt,
        ...(input.status === 'accepted' ? { acceptedAt: input.updatedAt } : {}),
      });
      return plan;
    },
    saveSourcePlanRelation: (relation: any) => {
      relations.push(relation);
      return relation;
    },
  };
}

describe('PermissionSnapshotService', () => {
  it('creates permission snapshots with canonical names', () => {
    const repository = createRepository();
    const service = new PermissionSnapshotService({
      repository,
      ids: {
        permissionSnapshotId: () => 'permission-snapshot:1',
        planArtifactId: () => 'plan:1',
      },
    });

    const snapshot = service.createPermissionSnapshot({
      runId: 'run:1',
      permissionMode: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    });

    expect(snapshot).toEqual({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    });
  });

  it('creates implementation plan records for plan permission mode state', () => {
    const repository = createRepository();
    const service = new PermissionSnapshotService({
      repository,
      ids: {
        permissionSnapshotId: () => 'permission-snapshot:1',
        planArtifactId: () => 'plan:1',
      },
    });

    expect(service.createPlanRecordForRun({
      runId: 'run:1',
      goal: 'Write a plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
    })).toMatchObject({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      status: 'proposed',
    });
  });
});
