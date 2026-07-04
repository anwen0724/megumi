import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../../../..');
const workspaceRoot = join(repoRoot, 'packages/coding-agent/workspace');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('workspace module boundary v2', () => {
  it('uses the target contracts/services/repositories/core structure', () => {
    expect(existsSync(join(workspaceRoot, 'contracts/workspace-contracts.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'contracts/workspace-change-contracts.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'services/workspace-service.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'services/workspace-path-policy-service.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'services/workspace-change-service.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'repositories/workspace-repository.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'repositories/workspace-change-repository.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'core/workspace-path-policy.ts'))).toBe(true);
    expect(existsSync(join(workspaceRoot, 'core/workspace-change-tracking.ts'))).toBe(true);

    expect(existsSync(join(workspaceRoot, 'project-service.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'path-policy.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'workspace-change-tracker.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'workspace-change-read.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'workspace-restore.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'workspace-change-footer-projector.ts'))).toBe(false);
  });

  it('keeps Workspace free of shared project/workspace contracts and legacy persistence repos', () => {
    const files = [
      'packages/coding-agent/workspace/contracts/workspace-contracts.ts',
      'packages/coding-agent/workspace/contracts/workspace-change-contracts.ts',
      'packages/coding-agent/workspace/services/workspace-service.ts',
      'packages/coding-agent/workspace/services/workspace-path-policy-service.ts',
      'packages/coding-agent/workspace/services/workspace-change-service.ts',
      'packages/coding-agent/workspace/repositories/workspace-repository.ts',
      'packages/coding-agent/workspace/repositories/workspace-change-repository.ts',
      'packages/coding-agent/workspace/core/workspace-path-policy.ts',
      'packages/coding-agent/workspace/core/workspace-change-tracking.ts',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain('@megumi/shared/project');
      expect(source).not.toContain('@megumi/shared/workspace');
      expect(source).not.toContain('../persistence/repos/workspace.repo');
      expect(source).not.toContain('../persistence/repos/workspace-change.repo');
      expect(source).not.toContain('WorkspaceRestore');
      expect(source).not.toContain('restoreChangeSet');
      expect(source).not.toContain('saveFileSnapshot');
    }
  });
});
