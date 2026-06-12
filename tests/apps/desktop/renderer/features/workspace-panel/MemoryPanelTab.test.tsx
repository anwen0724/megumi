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
          scope: 'project',
          projectId: 'project-1',
          kind: 'fact',
          status: 'active',
          content: 'The user wants clean session run panels.',
          summary: 'The user wants clean session run panels.',
          normalizedText: 'the user wants clean session run panels',
          dedupeKey: 'project:project-1:fact:clean-session-run-panels',
          source: 'manual_system',
          sourceRunId: null,
          sourceSessionId: null,
          sourceMessageId: null,
          sourceToolCallId: null,
          evidence: [],
          supersededById: null,
          sourceRefs: [],
          confidence: 0.9,
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
          lastUsedAt: null,
          useCount: 0,
          deletedAt: null,
          metadata: {},
        },
      ],
    });

    render(<MemoryPanelTab />);

    expect(screen.getByText('The user wants clean session run panels.')).toBeInTheDocument();
    expect(screen.getByText('project / fact')).toBeInTheDocument();
  });

  it('renders memory settings and proposed candidates from the memory store', () => {
    useMemoryStore.setState({
      settings: {
        workspaceId: 'workspace-1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      },
      candidates: [
        {
          candidateId: 'memory-candidate-1',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          scope: 'project',
          kind: 'decision',
          content: 'safe content',
          summary: 'spec first workflow',
          sourceRefs: [],
          confidence: 0.8,
          riskLevel: 'low',
          status: 'proposed',
          proposedBy: 'agent',
          createdAt: '2026-05-16T00:00:00.000Z',
        },
      ],
    });

    render(<MemoryPanelTab />);

    expect(screen.getByText('auto capture on')).toBeInTheDocument();
    expect(screen.getByText('spec first workflow')).toBeInTheDocument();
    expect(screen.getByText('project / decision')).toBeInTheDocument();
  });
});
