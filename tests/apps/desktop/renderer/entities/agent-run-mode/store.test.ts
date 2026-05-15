import { beforeEach, describe, expect, it } from 'vitest';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/agent-run-mode-contracts';
import { useAgentRunModeStore } from '@megumi/desktop/renderer/entities/agent-run-mode';

describe('useAgentRunModeStore', () => {
  beforeEach(() => {
    useAgentRunModeStore.getState().clearRunModeState();
  });

  it('tracks active run mode snapshots by run id', () => {
    useAgentRunModeStore.getState().setRunModeSnapshot('run:1', {
      modeSnapshotId: 'mode-snapshot:1',
      runId: 'run:1',
      modeLabel: 'plan',
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(useAgentRunModeStore.getState().activeRunId).toBe('run:1');
    expect(useAgentRunModeStore.getState().modeSnapshotsByRun['run:1'].mode.permissionMode).toBe('plan');
  });

  it('tracks plan-specific status by producing run', () => {
    useAgentRunModeStore.getState().setPlanForRun('run:plan', {
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    useAgentRunModeStore.getState().updatePlanStatus('plan:1', 'accepted', '2026-05-15T00:00:01.000Z');

    expect(useAgentRunModeStore.getState().plansByRun['run:plan'].status).toBe('accepted');
    expect(useAgentRunModeStore.getState().plansByRun['run:plan'].acceptedAt).toBe('2026-05-15T00:00:01.000Z');
  });

  it('marks reserved permission modes as disabled for 04 UI state', () => {
    expect(useAgentRunModeStore.getState().isPermissionModeEnabled('default')).toBe(true);
    expect(useAgentRunModeStore.getState().isPermissionModeEnabled('plan')).toBe(true);
    expect(useAgentRunModeStore.getState().isPermissionModeEnabled('accept_edits')).toBe(false);
    expect(useAgentRunModeStore.getState().isPermissionModeEnabled('auto')).toBe(false);
    expect(useAgentRunModeStore.getState().isPermissionModeEnabled('bypass_permissions')).toBe(false);
  });
});
