// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectManagerModal } from '@megumi/desktop/renderer/shell/ProjectManagerModal';

const projects = [
  {
    id: 'project-1',
    projectId: 'project:abc123',
    name: 'megumi',
    repoPath: 'C:/workspaces/megumi',
    repoPathKey: 'c:/all/work/study/megumi',
    status: 'available' as const,
    createdAt: '2026-05-19T00:00:00.000Z',
    lastOpenedAt: '2026-05-19T00:00:01.000Z',
  },
  {
    id: 'project-2',
    projectId: 'project:def456',
    name: 'older',
    repoPath: 'C:/Work/Older',
    repoPathKey: 'c:/work/older',
    status: 'missing' as const,
    createdAt: '2026-05-18T00:00:00.000Z',
    lastOpenedAt: '2026-05-18T00:00:01.000Z',
  },
];

describe('ProjectManagerModal', () => {
  const user = userEvent.setup();

  it('renders nothing when closed', () => {
    const { container } = render(
      <ProjectManagerModal
        open={false}
        projects={[]}
        onClose={vi.fn()}
        onOpenProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows project list sorted by lastOpenedAt desc', async () => {
    const onOpenProject = vi.fn();
    const onRemoveProject = vi.fn();
    const onClose = vi.fn();

    render(
      <ProjectManagerModal
        open
        projects={projects}
        onClose={onClose}
        onOpenProject={onOpenProject}
        onRemoveProject={onRemoveProject}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Manage projects' })).toBeInTheDocument();
    expect(screen.getByText('C:/workspaces/megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/Work/Older')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();

    // Open project action
    await user.click(screen.getByRole('button', { name: 'Open megumi' }));
    expect(onOpenProject).toHaveBeenCalledWith('project-1');

    // Remove project action
    await user.click(screen.getByRole('button', { name: 'Remove megumi from the list' }));
    expect(onRemoveProject).toHaveBeenCalledWith('project-1');

    // Close button
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
