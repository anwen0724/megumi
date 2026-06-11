import { describe, expect, it } from 'vitest';
import { usePermissionSnapshotStore } from '@megumi/desktop/renderer/entities/permission-snapshot';
import { useRunModeStore } from '@megumi/desktop/renderer/entities/run-mode';

describe('useRunModeStore compatibility shim', () => {
  it('re-exports the permission snapshot store for legacy imports', () => {
    expect(useRunModeStore).toBe(usePermissionSnapshotStore);
  });
});
