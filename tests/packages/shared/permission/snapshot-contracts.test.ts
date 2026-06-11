import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PERMISSION_MODES,
  PermissionModeSchema,
  PermissionModeStateSchema,
  PermissionSnapshotRecordSchema,
  toPermissionModeSnapshot,
} from '@megumi/shared/permission';

describe('permission-snapshot-contracts', () => {
  it('defines permission mode state without run mode taxonomy', () => {
    expect(ACTIVE_PERMISSION_MODES).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeStateSchema.parse({
      permissionMode: 'plan',
      source: 'intent_default',
    })).toEqual({
      permissionMode: 'plan',
      source: 'intent_default',
    });
    expect(() => PermissionModeStateSchema.parse({
      permissionMode: 'review',
      source: 'user',
    })).toThrow();
    expect(() => PermissionModeStateSchema.parse({
      permissionMode: 'plan',
      taskIntent: 'review',
    })).toThrow();
  });

  it('defines permission snapshot records with permissionSnapshotId and permissionModeState', () => {
    expect(PermissionSnapshotRecordSchema.parse({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
      metadata: {
        intent: {
          intentName: 'code_review',
          source: 'core_command',
          commandName: 'review',
          argsText: '当前改动',
        },
      },
    })).toEqual({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-06-11T00:00:00.000Z',
      metadata: {
        intent: {
          intentName: 'code_review',
          source: 'core_command',
          commandName: 'review',
          argsText: '当前改动',
        },
      },
    });
  });

  it('rejects legacy workflow_default permission source', () => {
    expect(() => PermissionModeStateSchema.parse({
      permissionMode: 'plan',
      source: 'workflow_default',
    })).toThrow();
  });

  it('creates model-visible permission snapshots from permission mode state', () => {
    expect(toPermissionModeSnapshot({
      permissionMode: 'plan',
      source: 'intent_default',
      createdAt: '2026-06-11T00:00:00.000Z',
    })).toEqual({
      permissionMode: 'plan',
      source: 'intent_default',
      createdAt: '2026-06-11T00:00:00.000Z',
    });
  });
});

