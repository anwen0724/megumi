import { describe, expect, it } from 'vitest';
import {
  createRunModeRuntimeInstruction,
  resolveRunModeSnapshot,
} from '@megumi/core/run-runtime/run-mode';
import {
  createPermissionModeRuntimeInstruction,
  resolvePermissionModeState,
} from '@megumi/core/run-runtime/permission-mode';

describe('core run mode compatibility shim', () => {
  it('re-exports permission mode helpers for legacy imports', () => {
    expect(resolveRunModeSnapshot).toBe(resolvePermissionModeState);
    expect(createRunModeRuntimeInstruction).toBe(createPermissionModeRuntimeInstruction);
  });
});
