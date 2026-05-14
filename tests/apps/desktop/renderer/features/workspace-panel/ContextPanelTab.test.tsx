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

    expect(screen.getByText('No workspace selected')).toBeInTheDocument();
  });

  it('renders selected project context', () => {
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          description: 'Warm agent desktop companion',
          repoPath: 'C:/all/work/study/megumi',
          type: 'existing_feature',
          createdAt: '2026-05-09T00:00:00.000Z',
          context: { files: ['README.md'] },
        },
      ],
      currentProjectId: 'project-1',
      loading: false,
    });

    render(<ContextPanelTab />);

    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/all/work/study/megumi')).toBeInTheDocument();
    expect(screen.getByText('existing_feature')).toBeInTheDocument();
  });
});
