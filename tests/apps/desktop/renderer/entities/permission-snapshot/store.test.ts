import { beforeEach, describe, expect, it } from 'vitest';
import { usePermissionSnapshotStore } from '@megumi/desktop/renderer/entities/permission-snapshot';

describe('usePermissionSnapshotStore', () => {
  beforeEach(() => {
    usePermissionSnapshotStore.getState().clearPermissionSnapshotState();
  });

  it('tracks active permission snapshots by run id', () => {
    usePermissionSnapshotStore.getState().setPermissionSnapshot('run:1', {
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(usePermissionSnapshotStore.getState().activeRunId).toBe('run:1');
    expect(
      usePermissionSnapshotStore.getState().permissionSnapshotsByRun['run:1'].permissionModeState.permissionMode,
    ).toBe('plan');
  });

  it('tracks plan-specific status by producing run', () => {
    usePermissionSnapshotStore.getState().setPlanForRun('run:plan', {
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    usePermissionSnapshotStore.getState().updatePlanStatus('plan:1', 'accepted', '2026-05-15T00:00:01.000Z');

    expect(usePermissionSnapshotStore.getState().plansByRun['run:plan'].status).toBe('accepted');
    expect(usePermissionSnapshotStore.getState().plansByRun['run:plan'].acceptedAt)
      .toBe('2026-05-15T00:00:01.000Z');
  });

  it('enables the 05 permission posture modes', () => {
    expect(usePermissionSnapshotStore.getState().isPermissionModeEnabled('default')).toBe(true);
    expect(usePermissionSnapshotStore.getState().isPermissionModeEnabled('plan')).toBe(true);
    expect(usePermissionSnapshotStore.getState().isPermissionModeEnabled('accept_edits')).toBe(true);
    expect(usePermissionSnapshotStore.getState().isPermissionModeEnabled('auto')).toBe(true);
  });

  it('clears permission snapshots by run', () => {
    usePermissionSnapshotStore.getState().setPermissionSnapshot('run:1', {
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    usePermissionSnapshotStore.getState().clearPermissionSnapshotState();

    expect(usePermissionSnapshotStore.getState().permissionSnapshotsByRun).toEqual({});
  });
});
