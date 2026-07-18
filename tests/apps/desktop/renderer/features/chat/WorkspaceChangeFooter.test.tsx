// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceChangeFooter } from '@megumi/desktop/renderer/features/chat/components/WorkspaceChangeFooter';
import type { WorkspaceChangeFooterFact } from '@megumi/agent/projections/workspace/workspace-change-footer-projector';

describe('WorkspaceChangeFooter', () => {
  it('renders localized copy from structured workspace change facts', async () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceChangeFooter
        footer={workspaceChangeFooter()}
        onOpenFile={onOpenFile}
      />,
    );

    expect(screen.getByRole('region', { name: 'Workspace changes for this turn' })).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getAllByText('README.md').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('contentText')).not.toBeInTheDocument();
    expect(screen.queryByText('beforeHash')).not.toBeInTheDocument();

    const openFiles = screen.getByRole('list', { name: 'Changed files that can be opened' });
    const fileList = screen.getByRole('list', { name: 'Changed files' });
    expect(openFiles.compareDocumentPosition(fileList)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(fileList).toHaveClass('divide-y');
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('File change summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();

    const appRow = within(openFiles).getByText('app.ts').closest('li');
    expect(appRow).not.toBeNull();
    if (!appRow) {
      throw new Error('Expected app row.');
    }
    expect(appRow).toHaveAttribute('data-workspace-open-file-row', 'true');

    await userEvent.click(within(appRow).getByRole('button', { name: 'Open' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
  });

  it('uses a compact changed-file list without open cards for large changes', () => {
    render(
      <WorkspaceChangeFooter
        footer={workspaceChangeFooter({
          files: Array.from({ length: 6 }, (_, index) => ({
            changedFileId: `workspace-changed-file-${index + 1}`,
            workspacePath: `src/file-${index + 1}.ts`,
            changeKind: 'modified',
          })),
        })}
        onOpenFile={() => undefined}
      />,
    );

    expect(screen.queryByRole('list', { name: 'Changed files that can be opened' })).not.toBeInTheDocument();
    expect(screen.getByText('6 files changed')).toBeInTheDocument();
    expect(screen.getByText('src/file-1.ts')).toBeInTheDocument();
    expect(screen.getByText('3 more files')).toBeInTheDocument();
  });
});

function workspaceChangeFooter(input?: {
  files?: WorkspaceChangeFooterFact['changeSets'][number]['files'];
}): WorkspaceChangeFooterFact {
  const files = input?.files ?? [
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
  ];

  return {
    runId: 'run-1',
    sessionId: 'session-1',
    updatedAt: '2026-06-06T10:00:00.000Z',
    changeSets: [{
      changeSetId: 'workspace-change-set-1',
      changedFileCount: files.length,
      files,
    }],
  };
}

