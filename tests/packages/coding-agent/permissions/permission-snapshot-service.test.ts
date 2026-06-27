import { describe, expect, it } from 'vitest';
import { PermissionSnapshotService } from '@megumi/coding-agent/permissions';

function createRepository() {
  const snapshots: any[] = [];
  const relations: any[] = [];

  return {
    snapshots,
    relations,
    savePermissionSnapshot: (snapshot: any) => {
      snapshots.push(snapshot);
      return snapshot;
    },
    getImplementationPlan: (_planArtifactId: string) => undefined,
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
});

