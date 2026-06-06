// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceChangeFooter } from '@megumi/desktop/renderer/features/chat/components/WorkspaceChangeFooter';
import type { WorkspaceChangeFooterFact } from '@megumi/shared/workspace-change-contracts';

describe('WorkspaceChangeFooter', () => {
  it('renders renderer-owned Chinese copy from structured workspace change facts', async () => {
    const onOpenFile = vi.fn();
    const onRestoreChangeSet = vi.fn();

    render(
      <WorkspaceChangeFooter
        footer={workspaceChangeFooter()}
        pendingChangeSetIds={new Set()}
        onOpenFile={onOpenFile}
        onRestoreChangeSet={onRestoreChangeSet}
      />,
    );

    expect(screen.getByRole('region', { name: '本轮工作区变更' })).toBeInTheDocument();
    expect(screen.getByText('Megumi 修改了 2 个文件')).toBeInTheDocument();
    expect(screen.getByText('可撤销 1 个，冲突 1 个')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.queryByText('contentText')).not.toBeInTheDocument();
    expect(screen.queryByText('beforeHash')).not.toBeInTheDocument();

    const appRow = screen.getByText('src/app.ts').closest('li');
    expect(appRow).not.toBeNull();
    if (!appRow) {
      throw new Error('Expected app row.');
    }

    await userEvent.click(within(appRow).getByRole('button', { name: '打开' }));
    await userEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
    expect(onRestoreChangeSet).toHaveBeenCalledWith('workspace-change-set-1');
  });

  it('disables restore when the change set has no restorable changes', () => {
    render(
      <WorkspaceChangeFooter
        footer={{
          ...workspaceChangeFooter(),
          changeSets: [{
            ...workspaceChangeFooter().changeSets[0],
            restorableCount: 0,
            conflictCount: 2,
            hasRestorableChanges: false,
          }],
        }}
        pendingChangeSetIds={new Set()}
        onOpenFile={vi.fn()}
        onRestoreChangeSet={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });
});

function workspaceChangeFooter(): WorkspaceChangeFooterFact {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    updatedAt: '2026-06-06T10:00:00.000Z',
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
          changeKind: 'modified',
          restoreState: 'conflict',
        },
      ],
    }],
  };
}
