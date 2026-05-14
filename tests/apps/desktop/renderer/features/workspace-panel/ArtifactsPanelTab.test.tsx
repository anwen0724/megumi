// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactsPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useWorkspaceStateStore } from '@megumi/desktop/renderer/entities/workspace-state';

describe('ArtifactsPanelTab', () => {
  beforeEach(() => {
    useWorkspaceStateStore.setState({
      tasks: [],
      artifacts: [],
      memoryNotes: [],
      activeRunId: null,
    });
  });

  it('renders loading state', () => {
    render(<ArtifactsPanelTab loading artifacts={[]} />);

    expect(screen.getByText('Loading artifacts')).toBeInTheDocument();
  });

  it('renders empty state from explicit props', () => {
    render(<ArtifactsPanelTab artifacts={[]} />);

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
  });

  it('renders artifact cards from explicit props', () => {
    render(
      <ArtifactsPanelTab
        artifacts={[
          {
            id: 'artifact-1',
            title: 'Implementation plan',
            type: 'task_list',
            status: 'created',
            filePath: 'docs/superpowers/plans/plan.md',
          },
        ]}
      />,
    );

    expect(screen.getByText('Implementation plan')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('renders artifacts from workspace state when props are not provided', () => {
    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:01.000Z',
    });

    render(<ArtifactsPanelTab />);

    expect(screen.getByText('Mock response notes')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('tech_report')).toBeInTheDocument();
  });
});
