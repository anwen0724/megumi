import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryPanelTab } from '@megumi/desktop/renderer/features/workspace-panel/components/MemoryPanelTab';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';

describe('MemoryPanelTab', () => {
  it('renders memory settings candidates records and recall preview states', () => {
    useMemoryStore.setState({
      settings: {
        workspaceId: 'workspace:1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      },
      candidates: [
        {
          candidateId: 'memory-candidate:1',
          workspaceId: 'workspace:1',
          scope: 'workspace',
          kind: 'workflow',
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
      memories: [
        {
          memoryId: 'memory:1',
          workspaceId: 'workspace:1',
          scope: 'workspace',
          kind: 'constraint',
          content: 'channel in meta',
          summary: 'IPC channel constraint',
          sourceRefs: [],
          confidence: 1,
          status: 'active',
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      ],
      recallPreview: undefined,
      loading: false,
      error: undefined,
    });

    render(<MemoryPanelTab />);

    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('auto capture on')).toBeInTheDocument();
    expect(screen.getByText('spec first workflow')).toBeInTheDocument();
    expect(screen.getByText('IPC channel constraint')).toBeInTheDocument();
  });
});
