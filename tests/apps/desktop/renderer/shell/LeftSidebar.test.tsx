// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeftSidebar } from '@megumi/desktop/renderer/shell/LeftSidebar';

const sessions = [
  { id: 'session-1', title: 'Planning the UI', meta: '12h', active: true },
  { id: 'session-2', title: 'Review notes', meta: '2d', active: false },
];

describe('LeftSidebar', () => {
  it('renders the simplified workspace navigation when expanded', () => {
    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
      />,
    );

    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'megumi sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Planning the UI/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('12h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText('Assistant activity')).not.toBeInTheDocument();
    expect(screen.queryByText('C:/all/work/study/megumi')).not.toBeInTheDocument();
  });

  it('calls onCreateSession from the expanded new session button', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={onCreateSession}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('renders a lightweight empty state when there are no sessions', () => {
    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="Local sessions"
        sessions={[]}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
      />,
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a session' })).not.toBeInTheDocument();
  });

  it('renders a compact rail with session creation and task plan access when collapsed', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        collapsed
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={onCreateSession}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Primary workspace navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task plan' })).toBeInTheDocument();
    expect(screen.queryByText('Planning the UI')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapsed when the collapse button is clicked', async () => {
    const onToggleCollapsed = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={onToggleCollapsed}
        onCreateSession={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings from the expanded settings button', async () => {
    const onOpenSettings = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings from the collapsed settings button', async () => {
    const onOpenSettings = vi.fn();

    render(
      <LeftSidebar
        collapsed
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectSession when a session is clicked', async () => {
    const onSelectSession = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
        onSelectSession={onSelectSession}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Review notes/ }));

    expect(onSelectSession).toHaveBeenCalledWith('session-2');
  });

  it('supports compact show more when the workspace has many sessions', async () => {
    const manySessions = Array.from({ length: 7 }, (_, index) => ({
      id: `session-${index + 1}`,
      title: `Session ${index + 1}`,
      meta: `${index + 1}h`,
      active: index === 0,
    }));

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={manySessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: /Session 7/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more sessions' }));

    expect(screen.getByRole('button', { name: /Session 7/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer sessions' })).toBeInTheDocument();
  });

  it('toggles the workspace session group without rendering a visible arrow glyph', async () => {
    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
      />,
    );

    const workspaceToggle = screen.getByRole('button', { name: 'megumi sessions' });
    expect(workspaceToggle).toHaveAttribute('aria-expanded', 'true');
    expect(workspaceToggle).not.toHaveTextContent('▾');
    expect(workspaceToggle).not.toHaveTextContent('>');

    await userEvent.click(workspaceToggle);

    expect(workspaceToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Planning the UI/ })).not.toBeInTheDocument();
  });
});
