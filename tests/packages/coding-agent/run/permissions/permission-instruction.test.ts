import { describe, expect, it } from 'vitest';
import {
  createPermissionModeRuntimeInstruction,
  resolvePermissionModeState,
} from '@megumi/coding-agent/run';

describe('core permission mode helpers', () => {
  it('resolves permission mode state from explicit permission mode', () => {
    expect(resolvePermissionModeState({ permissionMode: 'plan' })).toEqual({
      permissionMode: 'plan',
      source: 'system',
    });
  });

  it('resolves permission mode state from a persisted permission snapshot state', () => {
    expect(resolvePermissionModeState({
      permissionModeState: {
        permissionMode: 'auto',
        source: 'user',
      },
    })).toEqual({
      permissionMode: 'auto',
      source: 'user',
    });
  });

  it('builds runtime instruction text from permission mode state', () => {
    expect(createPermissionModeRuntimeInstruction({
      permissionMode: 'plan',
      source: 'intent_default',
    })).toEqual({
      permissionMode: 'plan',
      instruction: 'Plan mode: read and analyze project context, ask for verification commands, deny writes and unknown commands.',
    });
  });
});

