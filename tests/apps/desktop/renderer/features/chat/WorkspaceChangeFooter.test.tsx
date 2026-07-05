// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceChangeFooter } from '@megumi/desktop/renderer/features/chat/components/WorkspaceChangeFooter';
import type { WorkspaceChangeFooterFact } from '@megumi/coding-agent/projections/workspace/workspace-change-footer-projector';

describe('WorkspaceChangeFooter', () => {
  it('renders renderer-owned Chinese copy from structured workspace change facts', async () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceChangeFooter
        footer={workspaceChangeFooter()}
        onOpenFile={onOpenFile}
      />,
    );

    expect(screen.getByRole('region', { name: '本轮工作区变更' })).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getAllByText('README.md').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('contentText')).not.toBeInTheDocument();
    expect(screen.queryByText('beforeHash')).not.toBeInTheDocument();

    const fileList = screen.getByRole('list', { name: 'Changed files' });
    expect(fileList).toHaveClass('divide-y');
    expect(fileList).toHaveClass('rounded-md');
    expect(screen.getByText('Megumi 修改了 2 个文件')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();

    const appRow = screen.getByText('app.ts').closest('li');
    expect(appRow).not.toBeNull();
    if (!appRow) {
      throw new Error('Expected app row.');
    }
    expect(appRow).toHaveAttribute('data-workspace-change-file-row', 'true');

    await userEvent.click(within(appRow).getByRole('button', { name: '打开' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
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
      files: [
        {
          changedFileId: 'workspace-changed-file-1',
          workspacePath: 'src/app.ts',
          changeKind: 'modified',
        },
        {
          changedFileId: 'workspace-changed-file-2',
          workspacePath: 'README.md',
          changeKind: 'modified',
        },
      ],
    }],
  };
}

