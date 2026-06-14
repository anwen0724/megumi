// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeftSidebar } from '@megumi/desktop/renderer/shell/LeftSidebar';

const projects = [
  {
    id: 'project-1',
    name: 'megumi',
    repoPath: 'C:/all/work/study/megumi',
    status: 'available' as const,
    sessions: [
      { id: 'session-1', title: '了解项目', meta: '1 天', active: true },
      { id: 'session-2', title: '执行 Plan4', meta: '22 小时', active: false },
    ],
  },
];

const defaultProps = {
  collapsed: false,
  projects,
  onToggleCollapsed: () => undefined,
  onCreateSession: () => undefined,
  onUseExistingProject: () => undefined,
  onManageProjects: () => undefined,
};

describe('LeftSidebar', () => {
  it('renders simplified navigation with project tree when expanded', () => {
    render(<LeftSidebar {...defaultProps} />);

    expect(screen.queryByText('Megumi')).not.toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task plan' })).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'megumi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open session 了解项目/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('1 天')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText('megumi sessions')).not.toBeInTheDocument();
  });

  it('calls onCreateSession from the expanded new session button', async () => {
    const onCreateSession = vi.fn();

    render(<LeftSidebar {...defaultProps} onCreateSession={onCreateSession} />);

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when a project has no sessions', () => {
    render(
      <LeftSidebar
        {...defaultProps}
        projects={[
          { id: 'p1', name: 'megumi', repoPath: '/path', status: 'available', sessions: [] },
        ]}
      />,
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });

  it('renders compact rail when collapsed', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        {...defaultProps}
        collapsed
        onCreateSession={onCreateSession}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Primary project navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task plan' })).toBeInTheDocument();
    expect(screen.queryByText('了解项目')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapsed when the collapse button is clicked', async () => {
    const onToggleCollapsed = vi.fn();

    render(<LeftSidebar {...defaultProps} onToggleCollapsed={onToggleCollapsed} />);

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings from the expanded settings button', async () => {
    const onOpenSettings = vi.fn();

    render(<LeftSidebar {...defaultProps} onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings from the collapsed settings button', async () => {
    const onOpenSettings = vi.fn();

    render(
      <LeftSidebar
        {...defaultProps}
        collapsed
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectSession when a session is clicked', async () => {
    const onSelectSession = vi.fn();

    render(<LeftSidebar {...defaultProps} onSelectSession={onSelectSession} />);

    await userEvent.click(screen.getByRole('button', { name: /执行 Plan4/ }));

    expect(onSelectSession).toHaveBeenCalledWith('session-2');
  });

  it('gives session rows explicit accessible names and title text', () => {
    render(<LeftSidebar {...defaultProps} />);

    const activeSession = screen.getByRole('button', {
      name: 'Open session 了解项目, updated 1 天',
    });
    const inactiveSession = screen.getByRole('button', {
      name: 'Open session 执行 Plan4, updated 22 小时',
    });

    expect(activeSession).toHaveAttribute('title', '了解项目 · 1 天');
    expect(inactiveSession).toHaveAttribute('title', '执行 Plan4 · 22 小时');
    expect(activeSession).toHaveAttribute('aria-current', 'page');
  });

  it('supports show more when a project has many sessions', async () => {
    const manySessions = Array.from({ length: 7 }, (_, index) => ({
      id: `session-${index + 1}`,
      title: `Session ${index + 1}`,
      meta: `${index + 1}h`,
      active: index === 0,
    }));

    render(
      <LeftSidebar
        {...defaultProps}
        projects={[
          { id: 'p1', name: 'megumi', repoPath: '/path', status: 'available', sessions: manySessions },
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: /Session 7/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more sessions' }));

    expect(screen.getByRole('button', { name: /Session 7/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer sessions' })).toBeInTheDocument();
  });

  it('toggles project session visibility', async () => {
    render(<LeftSidebar {...defaultProps} />);

    const projectButton = screen.getByRole('button', { name: 'megumi' });
    expect(projectButton).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(projectButton);

    expect(projectButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /了解项目/ })).not.toBeInTheDocument();
  });

  it('renders project rows with folder icons and a visible theme hover state', () => {
    render(<LeftSidebar {...defaultProps} />);

    const projectRow = screen.getByRole('button', { name: 'megumi' });
    expect(screen.getByTestId('project-row-icon-project-1')).toBeInTheDocument();
    expect(projectRow).toHaveClass('hover:bg-[var(--color-accent-soft)]');
    expect(projectRow).not.toHaveAttribute('aria-current');
  });

  it('clicking project row does not trigger session select', async () => {
    const onSelectSession = vi.fn();

    render(<LeftSidebar {...defaultProps} onSelectSession={onSelectSession} />);

    await userEvent.click(screen.getByRole('button', { name: 'megumi' }));

    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('shows project menu with use/manage/create actions', async () => {
    const onUseExistingProject = vi.fn();
    const onManageProjects = vi.fn();

    render(
      <LeftSidebar
        {...defaultProps}
        onUseExistingProject={onUseExistingProject}
        onManageProjects={onManageProjects}
      />,
    );

    const projectActionsButton = screen.getByRole('button', { name: 'Project actions' });
    projectActionsButton.getBoundingClientRect = vi.fn(() => ({
      x: 244,
      y: 4,
      left: 244,
      top: 4,
      right: 276,
      bottom: 36,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    }));

    // Open project menu
    await userEvent.click(projectActionsButton);

    expect(screen.getByRole('menuitem', { name: 'Open project' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'New project' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Manage projects' })).toBeInTheDocument();

    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('fixed');
    expect(menu).not.toHaveClass('absolute');
    expect(menu).toHaveStyle({ left: '244px', top: '40px' });
    expect(menu).toHaveClass('bg-[var(--color-surface-muted)]');
    expect(screen.getByTestId('project-menu-open-icon')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open project' })).toHaveClass('hover:bg-[var(--color-accent-soft)]');
    expect(screen.getByRole('menuitem', { name: 'Manage projects' })).toHaveClass('hover:bg-[var(--color-accent-soft)]');

    // Click use existing project
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open project' }));
    expect(onUseExistingProject).toHaveBeenCalledTimes(1);

    // Click manage projects
    await userEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage projects' }));
    expect(onManageProjects).toHaveBeenCalledTimes(1);
  });

  it('keeps files out of the left sidebar navigation', () => {
    render(<LeftSidebar {...defaultProps} />);

    expect(screen.queryByText('Files')).not.toBeInTheDocument();
    expect(screen.queryByText('Artifacts')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('uses transition classes for expanded and collapsed sidebar motion', () => {
    const { rerender } = render(<LeftSidebar {...defaultProps} />);

    expect(screen.getByTestId('left-sidebar')).toHaveClass('transition-[width]');
    expect(screen.getByTestId('left-sidebar')).toHaveClass('w-72');

    rerender(<LeftSidebar {...defaultProps} collapsed />);

    expect(screen.getByTestId('left-sidebar')).toHaveClass('transition-[width]');
    expect(screen.getByTestId('left-sidebar')).toHaveClass('w-14');
  });
});
