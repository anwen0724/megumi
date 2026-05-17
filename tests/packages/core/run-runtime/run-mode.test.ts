import { describe, expect, it } from 'vitest';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/run-mode-contracts';
import {
  assertRuntimePermissionModeSupported,
  createRunModeRuntimeInstruction,
  defaultActionKindForRunMode,
  resolveRunModeSnapshot,
} from '@megumi/core/run-runtime/run-mode';

describe('core run mode helpers', () => {
  it('resolves preset defaults when no explicit snapshot is provided', () => {
    expect(resolveRunModeSnapshot({ mode: 'plan' })).toEqual(RUN_MODE_PRESET_DEFAULTS.plan);
    expect(resolveRunModeSnapshot({ mode: 'chat' })).toEqual(RUN_MODE_PRESET_DEFAULTS.chat);
  });

  it('uses explicit mode snapshots over short mode labels', () => {
    const mode = resolveRunModeSnapshot({
      mode: 'chat',
      modeSnapshot: {
        preset: 'review',
        taskIntent: 'review',
        permissionMode: 'plan',
        outputExpectation: 'review_findings',
        selectionSource: 'user_selected',
      },
    });

    expect(mode.preset).toBe('review');
    expect(mode.outputExpectation).toBe('review_findings');
  });

  it('rejects reserved permission modes in 04', () => {
    expect(() => assertRuntimePermissionModeSupported({
      preset: 'execute',
      taskIntent: 'work',
      permissionMode: 'auto',
      outputExpectation: 'execution_result',
    })).toThrow('Permission mode auto is reserved for a later capability stage.');
  });

  it('turns plan output expectation into create_artifact intent', () => {
    expect(defaultActionKindForRunMode(RUN_MODE_PRESET_DEFAULTS.plan)).toBe('create_artifact');
    expect(defaultActionKindForRunMode(RUN_MODE_PRESET_DEFAULTS.chat)).toBe('emit_message');
  });

  it('creates display-safe runtime instruction metadata', () => {
    expect(createRunModeRuntimeInstruction(RUN_MODE_PRESET_DEFAULTS.plan)).toEqual({
      taskIntent: 'plan',
      permissionMode: 'plan',
      outputExpectation: 'implementation_plan_artifact',
      instruction: 'Produce a reviewable implementation plan. Do not modify files or run side-effecting commands.',
    });
  });
});
