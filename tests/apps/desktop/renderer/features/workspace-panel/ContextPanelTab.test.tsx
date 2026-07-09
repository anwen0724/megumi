// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';

describe('ContextPanelTab', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });
  });

  it('renders loading state', () => {
    useProjectStore.setState({ loading: true });

    render(<ContextPanelTab />);

    expect(screen.getByText('Loading context')).toBeInTheDocument();
  });

  it('renders empty state when no project is selected', () => {
    render(<ContextPanelTab />);

    expect(screen.getByText('No project selected')).toBeInTheDocument();
  });

  it('renders selected project context', () => {
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          repoPath: 'C:/workspaces/megumi',
          createdAt: '2026-05-09T00:00:00.000Z',
          projectId: 'project-1',
          repoPathKey: 'c:/all/work/study/megumi',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          status: 'available' as const,
        },
      ],
      currentProjectId: 'project-1',
      loading: false,
    });

    render(<ContextPanelTab />);

    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/workspaces/megumi')).toBeInTheDocument();
    expect(screen.getByText('available')).toBeInTheDocument();
  });
});
