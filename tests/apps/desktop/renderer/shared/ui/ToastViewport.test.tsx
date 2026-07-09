/*
 * Verifies the shared top toast viewport.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastViewport, showToast, useToastStore } from '@megumi/desktop/renderer/shared/ui';

describe('ToastViewport', () => {
  afterEach(() => {
    vi.useRealTimers();
    useToastStore.getState().clearToasts();
  });

  it('renders a top notification and dismisses it manually', async () => {
    render(<ToastViewport />);

    act(() => {
      showToast({
        tone: 'error',
        title: 'Approval failed',
        message: 'Runtime interrupted before approval could resume.',
        durationMs: 0,
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Approval failed');
    expect(screen.getByText('Runtime interrupted before approval could resume.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.queryByText('Approval failed')).not.toBeInTheDocument();
  });

  it('auto dismisses notifications after their duration', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);

    act(() => {
      showToast({ title: 'Saved', durationMs: 100 });
    });

    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
