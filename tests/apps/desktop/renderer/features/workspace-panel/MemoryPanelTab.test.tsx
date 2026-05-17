// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';

describe('MemoryPanelTab', () => {
  beforeEach(() => {
    useMemoryStore.setState({
      settings: undefined,
      candidates: [],
      memories: [],
      selectedMemory: undefined,
      selectedSourceRefs: [],
      accessLogs: [],
      recallPreview: undefined,
      loading: false,
      error: undefined,
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

  it('renders memory domain records when props are not provided', () => {
    useMemoryStore.setState({
      settings: {
        workspaceId: 'workspace-1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
      memories: [
        {
          memoryId: 'memory-record-1',
          scope: 'workspace',
          kind: 'project_fact',
          content: 'The user wants clean session run panels.',
          status: 'active',
          summary: 'The user wants clean session run panels.',
          sourceRefs: [],
          confidence: 0.9,
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      ],
    });

    render(<MemoryPanelTab />);

    expect(screen.getByText('The user wants clean session run panels.')).toBeInTheDocument();
    expect(screen.getByText('workspace / project_fact')).toBeInTheDocument();
  });
});
