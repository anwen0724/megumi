import { describe, expect, it } from 'vitest';
import type {
  ClassifyWorkspacePathRequest,
  OpenWorkspaceRequest,
  Workspace,
  WorkspaceChangeSet,
  WorkspaceChangedFile,
  WorkspaceChangeService,
  WorkspacePathPolicyService,
  WorkspaceService,
} from '@megumi/coding-agent/workspace';

describe('workspace contracts v2', () => {
  it('models workspace business fields without project naming or metadata', () => {
    const workspace: Workspace = {
      workspace_id: 'workspace:1',
      name: 'megumi',
      root_path: 'C:/workspaces/megumi',
      root_path_key: 'c:/all/work/study/megumi',
      status: 'available',
      created_at: '2026-07-04T00:00:00.000Z',
      updated_at: '2026-07-04T00:00:00.000Z',
      last_opened_at: '2026-07-04T00:00:00.000Z',
    };
    const request: OpenWorkspaceRequest = {
      root_path: workspace.root_path,
    };

    expect(request.root_path).toBe(workspace.root_path);
    expect('opened_at' in request).toBe(false);
    expect('projectId' in workspace).toBe(false);
    expect('repoPath' in workspace).toBe(false);
    expect('metadata_json' in workspace).toBe(false);
  });

  it('models path policy requests with workspace terminology', () => {
    const request: ClassifyWorkspacePathRequest = {
      workspace_root: 'C:/repo',
      target_path: 'src/app.ts',
    };

    expect(request.workspace_root).toBe('C:/repo');
    expect('projectRoot' in request).toBe(false);
  });

  it('models workspace change facts without restore or snapshot fields', () => {
    const changeSet: WorkspaceChangeSet = {
      change_set_id: 'change:set:1',
      workspace_id: 'workspace:1',
      session_id: 'session:1',
      run_id: 'run:1',
      status: 'open',
      changed_file_count: 0,
      created_at: '2026-07-04T00:00:00.000Z',
    };
    const changedFile: WorkspaceChangedFile = {
      changed_file_id: 'changed:file:1',
      change_set_id: changeSet.change_set_id,
      workspace_path: 'src/app.ts',
      change_kind: 'modified',
      created_at: '2026-07-04T00:00:00.000Z',
    };

    expect(changedFile.change_set_id).toBe(changeSet.change_set_id);
    expect('restoreState' in changedFile).toBe(false);
    expect('beforeSnapshotId' in changedFile).toBe(false);
    expect('afterSnapshotId' in changedFile).toBe(false);
  });

  it('exposes the three public service contracts', () => {
    const workspaceService = {} as WorkspaceService;
    const pathPolicyService = {} as WorkspacePathPolicyService;
    const changeService = {} as WorkspaceChangeService;

    expect(workspaceService).toBeDefined();
    expect(pathPolicyService).toBeDefined();
    expect(changeService).toBeDefined();
  });
});
