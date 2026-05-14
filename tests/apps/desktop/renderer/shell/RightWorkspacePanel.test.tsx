// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RightWorkspacePanel } from '@megumi/desktop/renderer/shell/RightWorkspacePanel';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';

describe('RightWorkspacePanel', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          description: 'Warm agent desktop companion',
          repoPath: 'C:/all/work/study/megumi',
          type: 'existing_feature',
          createdAt: '2026-05-09T00:00:00.000Z',
          context: {},
        },
      ],
      currentProjectId: 'project-1',
      loading: false,
    });
  });

  it('renders Context tab by default', () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    expect(screen.getByRole('tab', { name: 'Context' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Megumi')).toBeInTheDocument();
  });

  it('switches to Tasks tab', async () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No active tasks')).toBeInTheDocument();
  });

  it('renders collapsed rail and calls toggle', async () => {
    const onToggleCollapsed = vi.fn();

    render(<RightWorkspacePanel collapsed onToggleCollapsed={onToggleCollapsed} />);

    await userEvent.click(screen.getByRole('button', { name: 'Expand workspace panel' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
