import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSelectionSourceSchema,
  PermissionModeSchema,
  PermissionModeSnapshotSchema,
  RunModeSchema,
} from '@megumi/shared/run-mode-contracts';

describe('run-mode-contracts compatibility shim', () => {
  it('re-exports permission snapshot contracts for legacy imports only', () => {
    expect(ACTIVE_PERMISSION_MODES).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(() => PermissionModeSchema.parse('chat')).toThrow();
    expect(() => PermissionModeSchema.parse('execute')).toThrow();
    expect(() => PermissionModeSchema.parse('review')).toThrow();
    expect(() => PermissionModeSchema.parse('bypass_permissions')).toThrow();
    expect(RunModeSchema.parse({
      permissionMode: 'auto',
      source: 'user',
    })).toEqual({
      permissionMode: 'auto',
      source: 'user',
    });
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
    expect(PermissionModeSelectionSourceSchema.options).toEqual([
      'user',
      'project',
      'local',
      'system',
      'workflow_default',
      'intent_default',
    ]);

    expect(PermissionModeSnapshotSchema.parse({
      permissionMode: 'plan',
      source: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    }).permissionMode).toBe('plan');

    expect(PermissionModeSnapshotSchema.parse({
      permissionMode: 'plan',
      source: 'workflow_default',
      createdAt: '2026-05-20T00:00:00.000Z',
    }).source).toBe('workflow_default');

    expect(PermissionModeSnapshotSchema.parse({
      permissionMode: 'plan',
      source: 'intent_default',
      createdAt: '2026-05-20T00:00:00.000Z',
    }).source).toBe('intent_default');
  });
});
