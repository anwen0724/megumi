import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@megumi/desktop/renderer/app/error-boundary';

function BrokenComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test crash');
  }
  return <div>All good</div>;
}

// Suppress React error boundary logging in test output
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('ErrorBoundary', () => {
  it('should render children normally when no error', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('should catch errors and show error UI with retry button', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('出错了')).toBeTruthy();
    expect(screen.getByText('Test crash')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
  });

  it('should re-render children after clicking retry', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.queryByText('All good')).toBeNull();

    // Click retry — this time the child won't throw (we replace it)
    screen.getByText('重试').click();

    // Re-render with a non-throwing child to simulate recovery
    rerender(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });
});
