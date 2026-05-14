// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeftSidebar } from '@megumi/desktop/renderer/shell/LeftSidebar';

const sessions = [
  { id: 'session-1', title: 'Planning the UI', meta: 'Free', active: true },
  { id: 'session-2', title: 'Review notes', meta: 'Reviewer', active: false },
];

describe('LeftSidebar', () => {
  it('renders workspace, primary actions, and sessions when expanded', () => {
    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
      />,
    );

    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/all/work/study/megumi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByText('Planning the UI')).toBeInTheDocument();
    expect(screen.getByText('Assistant activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('calls onCreateSession from the expanded new session button', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={onCreateSession}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('renders an actionable empty state when there are no sessions', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="Megumi"
        workspacePath="No workspace selected"
        sessions={[]}
        onToggleCollapsed={() => undefined}
        onCreateSession={onCreateSession}
      />,
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('renders a compact rail with a new-session action when collapsed', async () => {
    const onCreateSession = vi.fn();

    render(
      <LeftSidebar
        collapsed
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={onCreateSession}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Primary workspace navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.queryByText('Planning the UI')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapsed when the collapse button is clicked', async () => {
    const onToggleCollapsed = vi.fn();

    render(
      <LeftSidebar
        collapsed={false}
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
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
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
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
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
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
        workspaceName="Megumi"
        workspacePath="C:/all/work/study/megumi"
        sessions={sessions}
        onToggleCollapsed={() => undefined}
        onCreateSession={() => undefined}
        onSelectSession={onSelectSession}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Review notes/ }));

    expect(onSelectSession).toHaveBeenCalledWith('session-2');
  });
});
