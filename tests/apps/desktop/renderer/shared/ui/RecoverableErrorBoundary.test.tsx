/*
 * Verifies recoverable renderer errors become top toasts instead of full-page fallbacks.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverableErrorBoundary, ToastViewport, useToastStore } from '@megumi/desktop/renderer/shared/ui';

function BrokenChild() {
  throw new Error('Broken fragment');
  return null;
}

describe('RecoverableErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useToastStore.getState().clearToasts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useToastStore.getState().clearToasts();
  });

  it('hides the broken fragment and shows a toast', () => {
    render(
      <>
        <ToastViewport />
        <RecoverableErrorBoundary title="Block failed">
          <BrokenChild />
        </RecoverableErrorBoundary>
        <div>Still visible</div>
      </>,
    );

    expect(screen.getByText('Still visible')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Block failed');
  });
});
