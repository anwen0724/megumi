// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceChangeFooterProjectorService,
} from '@megumi/agent/projections/workspace/workspace-change-footer-projector';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/agent/workspace';

describe('WorkspaceChangeFooterProjectorService', () => {
  it('projects finalized workspace change sets into UI-safe footer facts', () => {
    const changeSet = workspaceChangeSet({
      change_set_id: 'workspace-change-set-1',
      changed_file_count: 2,
      status: 'finalized',
    });
    const summary = workspaceChangeSummary({
      change_set: changeSet,
      files: [
        workspaceChangedFile({
          changed_file_id: 'workspace-changed-file-1',
          workspace_path: 'src/app.ts',
          change_kind: 'modified',
        }),
        workspaceChangedFile({
          changed_file_id: 'workspace-changed-file-2',
          workspace_path: 'README.md',
          change_kind: 'created',
        }),
      ],
    });
    const service = createWorkspaceChangeFooterProjectorService({
      workspaceChanges: {
        listChangeSummaries: vi.fn(() => ({ summaries: [summary] })),
      },
    });

    const footer = service.projectRunFooter('run-1');

    expect(footer).toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      updatedAt: '2026-06-06T10:00:01.000Z',
      changeSets: [{
        changeSetId: 'workspace-change-set-1',
        changedFileCount: 2,
        files: [
          {
            changedFileId: 'workspace-changed-file-1',
            workspacePath: 'src/app.ts',
            changeKind: 'modified',
          },
          {
            changedFileId: 'workspace-changed-file-2',
            workspacePath: 'README.md',
            changeKind: 'created',
          },
        ],
      }],
    });
    expect(JSON.stringify(footer)).not.toContain('restoreState');
    expect(JSON.stringify(footer)).not.toContain('snapshot');
    expect(JSON.stringify(footer)).not.toContain('hash');
  });

  it('projects changed-file facts even when an older change set was not finalized', () => {
    const service = createWorkspaceChangeFooterProjectorService({
      workspaceChanges: {
        listChangeSummaries: vi.fn(() => ({
          summaries: [
            workspaceChangeSummary({
              change_set: workspaceChangeSet({
                change_set_id: 'workspace-change-set-draft',
                status: 'open',
                changed_file_count: 1,
              }),
            }),
            workspaceChangeSummary({
              change_set: workspaceChangeSet({
                change_set_id: 'workspace-change-set-empty',
                status: 'finalized',
                changed_file_count: 0,
              }),
              files: [],
            }),
          ],
        })),
      },
    });

    expect(service.projectRunFooter('run-1')).toMatchObject({
      runId: 'run-1',
      changeSets: [{
        changeSetId: 'workspace-change-set-draft',
        changedFileCount: 1,
      }],
    });
  });
});

function workspaceChangeSet(overrides: Partial<WorkspaceChangeSet>): WorkspaceChangeSet {
  return {
    change_set_id: 'workspace-change-set-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    run_id: 'run-1',
    status: 'finalized',
    changed_file_count: 1,
    created_at: '2026-06-06T10:00:00.000Z',
    finalized_at: '2026-06-06T10:00:01.000Z',
    ...overrides,
  };
}

function workspaceChangeSummary(overrides: Partial<WorkspaceChangeSummary>): WorkspaceChangeSummary {
  return {
    change_set: workspaceChangeSet({}),
    files: [workspaceChangedFile({})],
    ...overrides,
  };
}

function workspaceChangedFile(overrides: Partial<WorkspaceChangedFile>): WorkspaceChangedFile {
  return {
    changed_file_id: 'workspace-changed-file-1',
    change_set_id: 'workspace-change-set-1',
    workspace_path: 'src/app.ts',
    change_kind: 'modified',
    created_at: '2026-06-06T10:00:00.000Z',
    ...overrides,
  };
}
