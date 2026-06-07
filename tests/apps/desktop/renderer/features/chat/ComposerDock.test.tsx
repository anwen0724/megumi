// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComposerDock } from '@megumi/desktop/renderer/features/chat/layout/ComposerDock';

const emptySet = new Set<string>();

describe('ComposerDock', () => {
  it('owns approval, recoverable, branch draft, and composer surfaces outside the timeline log', () => {
    render(
      <ComposerDock
        status="idle"
        branchDraft={{
          key: 'branch-marker-1',
          label: 'Branch from 07:28',
          seedText: 'seed prompt',
          onCancel: vi.fn(),
        }}
        pendingApprovals={[]}
        recoverableRuns={[]}
        pendingRecoverableRunIds={emptySet}
        onApprovalResolve={vi.fn()}
        onRetry={vi.fn()}
        onRerun={vi.fn()}
        onMarkCancelled={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByTestId('composer-dock')).toBeInTheDocument();
    expect(screen.getByTestId('composer-dock-column')).toBeInTheDocument();
    expect(screen.getByTestId('branch-draft-stack')).toHaveTextContent('Branch from 07:28');
    expect(screen.getByRole('form', { name: 'Message composer' })).toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Chat timeline' })).not.toBeInTheDocument();
  });

  it('publishes measured dock height changes', () => {
    const onHeightChange = vi.fn();
    const ResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    render(
      <ComposerDock
        status="idle"
        branchDraft={null}
        pendingApprovals={[]}
        recoverableRuns={[]}
        pendingRecoverableRunIds={emptySet}
        onApprovalResolve={vi.fn()}
        onRetry={vi.fn()}
        onRerun={vi.fn()}
        onMarkCancelled={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onHeightChange={onHeightChange}
      />,
    );

    expect(onHeightChange).toHaveBeenCalledWith(expect.any(Number));
    globalThis.ResizeObserver = ResizeObserver;
  });
});
