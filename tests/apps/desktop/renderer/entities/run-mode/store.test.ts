import { beforeEach, describe, expect, it } from 'vitest';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/run-mode-contracts';
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
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
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

  it('marks reserved permission modes as disabled for 04 UI state', () => {
    expect(useRunModeStore.getState().isPermissionModeEnabled('default')).toBe(true);
    expect(useRunModeStore.getState().isPermissionModeEnabled('plan')).toBe(true);
    expect(useRunModeStore.getState().isPermissionModeEnabled('accept_edits')).toBe(false);
    expect(useRunModeStore.getState().isPermissionModeEnabled('auto')).toBe(false);
    expect(useRunModeStore.getState().isPermissionModeEnabled('bypass_permissions')).toBe(false);
  });
});
