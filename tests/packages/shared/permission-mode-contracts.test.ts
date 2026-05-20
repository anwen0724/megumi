import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeSnapshotSchema,
  isPermissionMode,
} from '@megumi/shared/permission-mode-contracts';

describe('permission-mode-contracts', () => {
  it('exposes the 05 target permission modes only', () => {
    expect(ACTIVE_PERMISSION_MODES).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
  });

  it('rejects old task mode and bypass permission values', () => {
    expect(() => PermissionModeSchema.parse('chat')).toThrow();
    expect(() => PermissionModeSchema.parse('execute')).toThrow();
    expect(() => PermissionModeSchema.parse('review')).toThrow();
    expect(() => PermissionModeSchema.parse('read_only')).toThrow();
    expect(() => PermissionModeSchema.parse('bypass_permissions')).toThrow();
  });

  it('parses permission mode snapshots without TaskIntent or OutputExpectation', () => {
    const snapshot = PermissionModeSnapshotSchema.parse({
      permissionMode: 'plan',
      source: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    });

    expect(snapshot.permissionMode).toBe('plan');
    expect(snapshot).not.toHaveProperty('taskIntent');
    expect(snapshot).not.toHaveProperty('outputExpectation');
  });

  it('narrows permission mode values', () => {
    expect(isPermissionMode('default')).toBe(true);
    expect(isPermissionMode('auto')).toBe(true);
    expect(isPermissionMode('chat')).toBe(false);
  });
});
