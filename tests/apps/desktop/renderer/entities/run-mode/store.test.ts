import { beforeEach, describe, expect, it } from 'vitest';
import { useRunModeStore } from '@megumi/desktop/renderer/entities/run-mode';

describe('useRunModeStore', () => {
  beforeEach(() => {
    useRunModeStore.getState().clearRunModeState();
  });

  it('tracks active run mode snapshots by run id', () => {
    useRunModeStore.getState().setRunModeSnapshot('run:1', {
      modeSnapshotId: 'mode-snapshot:1',
      runId: 'run:1',
      modeLabel: 'plan',
      mode: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(useRunModeStore.getState().activeRunId).toBe('run:1');
    expect(useRunModeStore.getState().modeSnapshotsByRun['run:1'].mode.permissionMode).toBe('plan');
  });

  it('tracks plan-specific status by producing run', () => {
    useRunModeStore.getState().setPlanForRun('run:plan', {
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    useRunModeStore.getState().updatePlanStatus('plan:1', 'accepted', '2026-05-15T00:00:01.000Z');

    expect(useRunModeStore.getState().plansByRun['run:plan'].status).toBe('accepted');
    expect(useRunModeStore.getState().plansByRun['run:plan'].acceptedAt).toBe('2026-05-15T00:00:01.000Z');
  });

  it('enables the 05 permission posture modes', () => {
    expect(useRunModeStore.getState().isPermissionModeEnabled('default')).toBe(true);
    expect(useRunModeStore.getState().isPermissionModeEnabled('plan')).toBe(true);
    expect(useRunModeStore.getState().isPermissionModeEnabled('accept_edits')).toBe(true);
    expect(useRunModeStore.getState().isPermissionModeEnabled('auto')).toBe(true);
  });
});
