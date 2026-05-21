import { describe, expect, it } from 'vitest';
import {
  createPermissionModeRuntimeInstruction,
  createRunModeRuntimeInstruction,
  resolveRunModeSnapshot,
} from '@megumi/core/run-runtime/run-mode';

describe('core run mode helpers', () => {
  it('resolves permission mode snapshots without task taxonomy', () => {
    expect(resolveRunModeSnapshot({ permissionMode: 'plan' })).toEqual({
      permissionMode: 'plan',
      source: 'system',
    });
    expect(resolveRunModeSnapshot({ mode: 'auto' })).toEqual({
      permissionMode: 'auto',
      source: 'system',
    });
    expect(resolveRunModeSnapshot({
      mode: 'default',
      modeSnapshot: {
        permissionMode: 'accept_edits',
        source: 'user',
      },
    })).toEqual({
      permissionMode: 'accept_edits',
      source: 'user',
    });
    expect(() => resolveRunModeSnapshot({ permissionMode: 'execute' })).toThrow();
  });

  it('creates permission mode instructions', () => {
    expect(createPermissionModeRuntimeInstruction({ permissionMode: 'default' }).instruction)
      .toContain('Default mode');
    expect(createPermissionModeRuntimeInstruction({ permissionMode: 'plan' }).instruction)
      .toContain('Plan mode');
    expect(createPermissionModeRuntimeInstruction({ permissionMode: 'accept_edits' }).instruction)
      .toContain('Accept edits mode');
    expect(createPermissionModeRuntimeInstruction({ permissionMode: 'auto' }).instruction)
      .toContain('Auto mode');
  });

  it('keeps the legacy helper name as a permission-mode alias', () => {
    expect(createRunModeRuntimeInstruction({ permissionMode: 'plan' })).toEqual(
      createPermissionModeRuntimeInstruction({ permissionMode: 'plan' }),
    );
  });
});
