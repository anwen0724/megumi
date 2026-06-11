import { describe, expect, it } from 'vitest';
import {
  PermissionModeSnapshotSchema as BarrelPermissionModeSnapshotSchema,
  PermissionModeSchema as BarrelPermissionModeSchema,
  ACTIVE_PERMISSION_MODES as BARREL_ACTIVE_PERMISSION_MODES,
} from '@megumi/shared';
import * as Shared from '@megumi/shared';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeSelectionSourceSchema,
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

  it('rejects old TaskIntent and OutputExpectation keys in permission mode snapshots', () => {
    const baseSnapshot = {
      permissionMode: 'plan',
      source: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    };

    expect(() =>
      PermissionModeSnapshotSchema.parse({
        ...baseSnapshot,
        taskIntent: 'plan',
      }),
    ).toThrow();
    expect(() =>
      PermissionModeSnapshotSchema.parse({
        ...baseSnapshot,
        outputExpectation: 'implementation_plan_artifact',
      }),
    ).toThrow();
  });

  it('keeps the public shared barrel pointed at target permission mode exports', () => {
    expect('PERMISSION_MODES' in Shared).toBe(false);
    expect(BARREL_ACTIVE_PERMISSION_MODES).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(BarrelPermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(
      BarrelPermissionModeSnapshotSchema.parse({
        permissionMode: 'accept_edits',
        source: 'project',
        createdAt: '2026-05-20T00:00:00.000Z',
      }).permissionMode,
    ).toBe('accept_edits');
  });

  it('narrows permission mode values', () => {
    expect(isPermissionMode('default')).toBe(true);
    expect(isPermissionMode('auto')).toBe(true);
    expect(isPermissionMode('chat')).toBe(false);
  });

  it('includes intent_default as the new command-derived permission source while keeping legacy workflow_default temporarily', () => {
    expect(PermissionModeSelectionSourceSchema.parse('intent_default')).toBe('intent_default');
    expect(PermissionModeSelectionSourceSchema.parse('workflow_default')).toBe('workflow_default');
  });
});
