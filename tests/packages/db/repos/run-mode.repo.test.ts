import { describe, expect, it } from 'vitest';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';

describe('RunModeRepository compatibility shim', () => {
  it('re-exports PermissionSnapshotRepository for legacy imports', () => {
    expect(RunModeRepository).toBe(PermissionSnapshotRepository);
  });
});
