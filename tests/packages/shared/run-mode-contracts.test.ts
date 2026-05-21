import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeSnapshotSchema,
  RunModeSchema,
} from '@megumi/shared/run-mode-contracts';

describe('run-mode-contracts compatibility shim', () => {
  it('re-exports the 05 permission posture model without legacy task taxonomy', () => {
    expect(ACTIVE_PERMISSION_MODES).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(() => PermissionModeSchema.parse('chat')).toThrow();
    expect(() => PermissionModeSchema.parse('execute')).toThrow();
    expect(() => PermissionModeSchema.parse('review')).toThrow();
    expect(() => PermissionModeSchema.parse('bypass_permissions')).toThrow();
  });

  it('keeps RunModeSchema as a thin compatibility shape around permissionMode only', () => {
    const mode = RunModeSchema.parse({
      permissionMode: 'auto',
      source: 'user',
    });

    expect(mode).toEqual({
      permissionMode: 'auto',
      source: 'user',
    });
    expect(mode).not.toHaveProperty('taskIntent');
    expect(mode).not.toHaveProperty('outputExpectation');
    expect(mode).not.toHaveProperty('preset');
    expect(() => RunModeSchema.parse({
      permissionMode: 'auto',
      source: 'user',
      taskIntent: 'work',
    })).toThrow();
    expect(() => RunModeSchema.parse({
      permissionMode: 'auto',
      source: 'user',
      outputExpectation: 'execution_result',
    })).toThrow();
    expect(() => RunModeSchema.parse({
      permissionMode: 'auto',
      source: 'user',
      preset: 'execute',
    })).toThrow();
  });

  it('parses permission snapshots through the canonical schema', () => {
    expect(PermissionModeSnapshotSchema.parse({
      permissionMode: 'plan',
      source: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    }).permissionMode).toBe('plan');
  });
});
