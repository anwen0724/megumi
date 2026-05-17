import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PERMISSION_MODES,
  IMPLEMENTATION_PLAN_ARTIFACT_STATUSES,
  RUN_MODE_PRESET_DEFAULTS,
  RunModeSchema,
  RunModeSnapshotSchema,
  ImplementationPlanArtifactRecordSchema,
  RunSourcePlanRelationSchema,
  isActivePermissionMode,
} from '@megumi/shared/run-mode-contracts';

describe('run mode contracts', () => {
  it('defines the initial mode presets as structured run modes', () => {
    expect(RUN_MODE_PRESET_DEFAULTS.chat).toMatchObject({
      preset: 'chat',
      taskIntent: 'answer',
      permissionMode: 'default',
      outputExpectation: 'assistant_message',
      selectionSource: 'default_setting',
    });
    expect(RUN_MODE_PRESET_DEFAULTS.plan).toMatchObject({
      preset: 'plan',
      taskIntent: 'plan',
      permissionMode: 'plan',
      outputExpectation: 'implementation_plan_artifact',
      selectionSource: 'default_setting',
    });
    expect(RUN_MODE_PRESET_DEFAULTS.execute).toMatchObject({
      preset: 'execute',
      taskIntent: 'work',
      permissionMode: 'default',
      outputExpectation: 'execution_result',
      selectionSource: 'default_setting',
    });
    expect(RUN_MODE_PRESET_DEFAULTS.review).toMatchObject({
      preset: 'review',
      taskIntent: 'review',
      permissionMode: 'plan',
      outputExpectation: 'review_findings',
      selectionSource: 'default_setting',
    });
  });

  it('allows future preset names while keeping known dimensions typed', () => {
    const parsed = RunModeSchema.parse({
      preset: 'research',
      taskIntent: 'explore',
      permissionMode: 'plan',
      outputExpectation: 'assistant_message',
      reason: 'User asked for read-only research.',
      selectionSource: 'host_inference',
    });

    expect(parsed.preset).toBe('research');
  });

  it('keeps default and plan as the only active permission modes in 04', () => {
    expect(ACTIVE_PERMISSION_MODES).toEqual(['default', 'plan']);
    expect(isActivePermissionMode('default')).toBe(true);
    expect(isActivePermissionMode('plan')).toBe(true);
    expect(isActivePermissionMode('accept_edits')).toBe(false);
    expect(isActivePermissionMode('auto')).toBe(false);
    expect(isActivePermissionMode('bypass_permissions')).toBe(false);
  });

  it('rejects unknown permission modes and unknown output expectations', () => {
    expect(() => RunModeSchema.parse({
      taskIntent: 'answer',
      permissionMode: 'root',
      outputExpectation: 'assistant_message',
    })).toThrow();

    expect(() => RunModeSchema.parse({
      taskIntent: 'answer',
      permissionMode: 'default',
      outputExpectation: 'spreadsheet',
    })).toThrow();
  });

  it('parses durable mode snapshots without embedding sourcePlanId into RunMode', () => {
    const snapshot = RunModeSnapshotSchema.parse({
      modeSnapshotId: 'mode-snapshot:1',
      runId: 'run:1',
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
      modeLabel: 'plan',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(snapshot.modeSnapshotId).toBe('mode-snapshot:1');
    expect(snapshot.mode).not.toHaveProperty('sourcePlanId');
  });

  it('defines only plan-specific artifact status and run source relation', () => {
    expect(IMPLEMENTATION_PLAN_ARTIFACT_STATUSES).toEqual([
      'draft',
      'proposed',
      'accepted',
      'rejected',
      'superseded',
    ]);

    const plan = ImplementationPlanArtifactRecordSchema.parse({
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Implementation plan',
      status: 'accepted',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:01.000Z',
      acceptedAt: '2026-05-15T00:00:01.000Z',
    });

    const relation = RunSourcePlanRelationSchema.parse({
      runId: 'run:execute',
      sourcePlanId: plan.planArtifactId,
      linkedAt: '2026-05-15T00:00:02.000Z',
    });

    expect(relation.sourcePlanId).toBe('plan:1');
  });

  it('exports run mode contracts from the shared package root', async () => {
    const shared = await import('@megumi/shared');

    expect(shared.RUN_MODE_PRESET_DEFAULTS.plan.permissionMode).toBe('plan');
    expect(shared.ImplementationPlanArtifactRecordSchema.parse({
      planArtifactId: 'plan:root-export',
      producingRunId: 'run:root-export',
      title: 'Root export plan',
      status: 'draft',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }).status).toBe('draft');
  });
});
