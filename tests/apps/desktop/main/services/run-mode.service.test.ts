import { describe, expect, it } from 'vitest';
import { RunModeService } from '@megumi/desktop/main/services/run-mode.service';
import { PermissionSnapshotService } from '@megumi/desktop/main/services/permission-snapshot.service';

describe('RunModeService compatibility shim', () => {
  it('re-exports PermissionSnapshotService for legacy imports', () => {
    expect(RunModeService).toBe(PermissionSnapshotService);
  });
});
