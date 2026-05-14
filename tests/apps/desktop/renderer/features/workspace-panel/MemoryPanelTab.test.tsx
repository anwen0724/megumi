// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useWorkspaceStateStore } from '@megumi/desktop/renderer/entities/workspace-state';

describe('MemoryPanelTab', () => {
  beforeEach(() => {
    useWorkspaceStateStore.setState({
      tasks: [],
      artifacts: [],
      memoryNotes: [],
      activeRunId: null,
    });
  });

  it('renders loading state', () => {
    render(<MemoryPanelTab loading notes={[]} />);

    expect(screen.getByText('Loading memory')).toBeInTheDocument();
  });

  it('renders empty state from explicit props', () => {
    render(<MemoryPanelTab notes={[]} />);

    expect(screen.getByText('No memory notes yet')).toBeInTheDocument();
  });

  it('renders memory notes from explicit props', () => {
    render(
      <MemoryPanelTab
        notes={[
          {
            id: 'memory-1',
            kind: 'summary',
            title: 'Session summary',
            body: 'The user wants clean-room UI redesign plans.',
          },
        ]}
      />,
    );

    expect(screen.getByText('Session summary')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('renders memory notes from workspace state when props are not provided', () => {
    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:01.000Z',
    });

    render(<MemoryPanelTab />);

    expect(screen.getByText('Session note')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Megumi explored "Start with the shell" in agent mode using deepseek-v4-pro.')).toBeInTheDocument();
  });
});
