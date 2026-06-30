// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceChangeFooterProjectorService } from '@megumi/coding-agent/workspace/workspace-change-footer-projector';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace';

describe('WorkspaceChangeFooterProjectorService', () => {
  it('projects finalized workspace change sets into UI-safe footer facts', () => {
    const changeSet = workspaceChangeSet({
      changeSetId: 'workspace-change-set-1',
      changedFileCount: 2,
      status: 'finalized',
    });
    const summary = workspaceChangeSummary({
      changeSetId: changeSet.changeSetId,
      changedFileCount: 2,
      restorableCount: 1,
      restoredCount: 0,
      conflictCount: 1,
      failedCount: 0,
      hasRestorableChanges: true,
    });
    const files: WorkspaceChangedFile[] = [
      workspaceChangedFile({
        changedFileId: 'workspace-changed-file-1',
        projectPath: 'src/app.ts',
        changeKind: 'modified',
        restoreState: 'restorable',
        beforeContentRefId: 'secret-before-ref',
        afterContentRefId: 'secret-after-ref',
        beforeHash: 'a'.repeat(64),
        afterHash: 'b'.repeat(64),
      }),
      workspaceChangedFile({
        changedFileId: 'workspace-changed-file-2',
        projectPath: 'README.md',
        changeKind: 'created',
        restoreState: 'conflict',
      }),
    ];
    const service = createWorkspaceChangeFooterProjectorService({
      workspaceChanges: {
        listWorkspaceChangesByRun: vi.fn(() => [changeSet]),
        getChangeSummary: vi.fn(() => summary),
        listChangedFilesByChangeSet: vi.fn(() => files),
      },
    });

    const footer = service.projectRunFooter('run-1');

    expect(footer).toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      updatedAt: '2026-06-06T10:00:02.000Z',
      changeSets: [{
        changeSetId: 'workspace-change-set-1',
        changedFileCount: 2,
        restorableCount: 1,
        restoredCount: 0,
        conflictCount: 1,
        failedCount: 0,
        hasRestorableChanges: true,
        files: [
          {
            changedFileId: 'workspace-changed-file-1',
            projectPath: 'src/app.ts',
            changeKind: 'modified',
            restoreState: 'restorable',
          },
          {
            changedFileId: 'workspace-changed-file-2',
            projectPath: 'README.md',
            changeKind: 'created',
            restoreState: 'conflict',
          },
        ],
      }],
    });
    expect(JSON.stringify(footer)).not.toContain('secret-before-ref');
    expect(JSON.stringify(footer)).not.toContain('beforeHash');
    expect(JSON.stringify(footer)).not.toContain('afterHash');
  });

  it('omits runs without finalized changed files', () => {
    const service = createWorkspaceChangeFooterProjectorService({
      workspaceChanges: {
        listWorkspaceChangesByRun: vi.fn(() => [
          workspaceChangeSet({
            changeSetId: 'workspace-change-set-draft',
            status: 'open',
            changedFileCount: 1,
          }),
          workspaceChangeSet({
            changeSetId: 'workspace-change-set-empty',
            status: 'finalized',
            changedFileCount: 0,
          }),
        ]),
        getChangeSummary: vi.fn((changeSetId: string) =>
          workspaceChangeSummary({
            changeSetId,
            changedFileCount: 0,
            restorableCount: 0,
            restoredCount: 0,
            conflictCount: 0,
            failedCount: 0,
            hasRestorableChanges: false,
          }),
        ),
        listChangedFilesByChangeSet: vi.fn(() => []),
      },
    });

    expect(service.projectRunFooter('run-1')).toBeUndefined();
  });
});

function workspaceChangeSet(overrides: Partial<WorkspaceChangeSet>): WorkspaceChangeSet {
  return {
    changeSetId: 'workspace-change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'finalized',
    changedFileCount: 1,
    createdAt: '2026-06-06T10:00:00.000Z',
    finalizedAt: '2026-06-06T10:00:01.000Z',
    ...overrides,
  };
}

function workspaceChangeSummary(overrides: Partial<WorkspaceChangeSummary>): WorkspaceChangeSummary {
  return {
    changeSetId: 'workspace-change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    changedFileCount: 1,
    restorableCount: 1,
    restoredCount: 0,
    conflictCount: 0,
    failedCount: 0,
    hasRestorableChanges: true,
    updatedAt: '2026-06-06T10:00:02.000Z',
    ...overrides,
  };
}

function workspaceChangedFile(overrides: Partial<WorkspaceChangedFile>): WorkspaceChangedFile {
  return {
    changedFileId: 'workspace-changed-file-1',
    changeSetId: 'workspace-change-set-1',
    workspaceCheckpointId: 'workspace-checkpoint-1',
    sessionId: 'session-1',
    runId: 'run-1',
    projectPath: 'src/app.ts',
    changeKind: 'modified',
    restoreState: 'restorable',
    createdAt: '2026-06-06T10:00:00.000Z',
    ...overrides,
    beforeExists: overrides.beforeExists ?? true,
    afterExists: overrides.afterExists ?? true,
    updatedAt: overrides.updatedAt ?? '2026-06-06T10:00:00.000Z',
  };
}


