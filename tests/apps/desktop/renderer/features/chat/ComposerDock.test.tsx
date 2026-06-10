// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('keeps the dock transparent while aligning its content to the chat column width', () => {
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
      />,
    );

    const dock = screen.getByTestId('composer-dock');
    const column = screen.getByTestId('composer-dock-column');

    expect(dock).toHaveClass('bg-transparent');
    expect(dock).toHaveClass('pb-3');
    expect(dock).not.toHaveClass('px-6');
    expect(dock).not.toHaveClass('pt-');
    expect(dock).not.toHaveClass('pb-6');
    expect(column).toHaveClass('relative');
    expect(column).toHaveClass('w-[calc(100%-3rem)]');
    expect(column).toHaveClass('max-w-[var(--chat-composer-width)]');
    expect(column).not.toHaveClass('px-6');
  });

  it('publishes composer surface avoidance height without overlay height', () => {
    const onHeightChange = vi.fn();
    const ResizeObserver = globalThis.ResizeObserver;
    const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    HTMLElement.prototype.getBoundingClientRect = function getMockRect() {
      const testId = this.getAttribute('data-testid');
      const height = testId === 'composer-surface'
        ? 120
        : testId === 'composer-dock'
          ? 320
          : 0;

      return {
        x: 0,
        y: 0,
        width: 800,
        height,
        top: 0,
        right: 800,
        bottom: height,
        left: 0,
        toJSON: () => undefined,
      };
    };

    try {
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

      expect(onHeightChange).toHaveBeenCalledWith(132);
      expect(onHeightChange).not.toHaveBeenCalledWith(320);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = getBoundingClientRect;
      globalThis.ResizeObserver = ResizeObserver;
    }
  });

  it('renders command suggestions in the dock overlay layer above the composer surface', async () => {
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
      />,
    );

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/re');

    const dockColumn = screen.getByTestId('composer-dock-column');
    const overlayLayer = screen.getByTestId('composer-overlay-layer');
    const commandPanel = screen.getByTestId('command-suggestion-panel');
    const composerSurface = screen.getByTestId('composer-surface');
    const inputPanel = screen.getByTestId('composer-input-panel');

    expect(overlayLayer.parentElement).toBe(dockColumn);
    expect(commandPanel.parentElement).toBe(overlayLayer);
    expect(composerSurface.parentElement).toBe(dockColumn);
    expect(Array.from(dockColumn.children).indexOf(overlayLayer)).toBeLessThan(
      Array.from(dockColumn.children).indexOf(composerSurface),
    );
    expect(overlayLayer).toHaveClass('absolute');
    expect(overlayLayer).toHaveClass('bottom-[calc(100%+0.5rem)]');
    expect(inputPanel).not.toContainElement(commandPanel);
    expect(screen.getByRole('option', { name: '/review Review code in the current project' })).toBeInTheDocument();
  });
});
