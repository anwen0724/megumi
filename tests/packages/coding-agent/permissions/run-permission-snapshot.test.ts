import { describe, expect, it, vi } from 'vitest';

import {
  createRunPermissionSnapshot,
  toModelPermissionSnapshot,
} from '@megumi/coding-agent/permissions';

describe('createRunPermissionSnapshot', () => {
  it('creates a snapshot from explicit permission mode and source', () => {
    const createPermissionSnapshot = vi.fn((input) => ({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: input.runId,
      permissionLabel: input.permissionMode,
      permissionModeState: input.permissionModeState,
      createdAt: input.createdAt,
      metadata: input.metadata,
    }));

    const snapshot = createRunPermissionSnapshot({
      service: {
        createPermissionSnapshot,
        linkAcceptedSourcePlan: vi.fn(),
      },
      runId: 'run-1',
      permissionMode: 'accept_edits',
      permissionSource: 'intent_default',
      metadata: {
        source: 'input',
      },
      createdAt: '2026-06-29T01:00:00.000Z',
    });

    expect(createPermissionSnapshot).toHaveBeenCalledWith({
      runId: 'run-1',
      permissionMode: 'accept_edits',
      permissionModeState: {
        permissionMode: 'accept_edits',
        source: 'intent_default',
      },
      metadata: {
        source: 'input',
      },
      createdAt: '2026-06-29T01:00:00.000Z',
    });
    expect(snapshot?.permissionSnapshotRef).toBe('permission-snapshot:1');
  });

  it('uses an existing permission mode state when provided', () => {
    const createPermissionSnapshot = vi.fn((input) => ({
      permissionSnapshotId: 'permission-snapshot:2',
      runId: input.runId,
      permissionLabel: input.permissionMode,
      permissionModeState: input.permissionModeState,
      createdAt: input.createdAt,
    }));

    const snapshot = createRunPermissionSnapshot({
      service: {
        createPermissionSnapshot,
        linkAcceptedSourcePlan: vi.fn(),
      },
      runId: 'run-2',
      permissionMode: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'system',
      },
      createdAt: '2026-06-29T01:00:00.000Z',
    });

    expect(createPermissionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      permissionModeState: {
        permissionMode: 'plan',
        source: 'system',
      },
    }));
    expect(snapshot?.record.permissionModeState.source).toBe('system');
  });

  it('links accepted source plans through the permission owner', () => {
    const linkAcceptedSourcePlan = vi.fn((input) => input);

    createRunPermissionSnapshot({
      service: {
        createPermissionSnapshot: vi.fn((input) => ({
          permissionSnapshotId: 'permission-snapshot:3',
          runId: input.runId,
          permissionLabel: input.permissionMode,
          permissionModeState: input.permissionModeState,
          createdAt: input.createdAt,
        })),
        linkAcceptedSourcePlan,
      },
      runId: 'run-3',
      permissionMode: 'plan',
      sourcePlanId: 'plan-1',
      createdAt: '2026-06-29T01:00:00.000Z',
    });

    expect(linkAcceptedSourcePlan).toHaveBeenCalledWith({
      runId: 'run-3',
      sourcePlanId: 'plan-1',
      linkedAt: '2026-06-29T01:00:00.000Z',
    });
  });

  it('returns undefined when no permission snapshot service is configured', () => {
    expect(createRunPermissionSnapshot({
      runId: 'run-4',
      permissionMode: 'default',
      createdAt: '2026-06-29T01:00:00.000Z',
    })).toBeUndefined();
  });

  it('maps stored permission snapshots into model-visible permission state', () => {
    expect(toModelPermissionSnapshot({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run-1',
      permissionLabel: 'accept_edits',
      permissionModeState: {
        permissionMode: 'accept_edits',
        source: 'intent_default',
      },
      createdAt: '2026-06-29T01:00:00.000Z',
    }, '2026-06-29T01:00:01.000Z')).toEqual({
      permissionMode: 'accept_edits',
      source: 'intent_default',
      createdAt: '2026-06-29T01:00:00.000Z',
    });
  });

  it('falls back to default permission state for non-canonical stored modes', () => {
    expect(toModelPermissionSnapshot({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run-1',
      permissionLabel: 'legacy',
      permissionModeState: {
        permissionMode: 'legacy',
        source: undefined,
      },
      createdAt: undefined,
    } as any, '2026-06-29T01:00:01.000Z')).toEqual({
      permissionMode: 'default',
      source: 'system',
      createdAt: '2026-06-29T01:00:01.000Z',
    });
  });
});
