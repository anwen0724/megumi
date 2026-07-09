import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[var(--color-app-bg)] text-[var(--color-text)]">
          <div
            role="alert"
            className="fixed left-1/2 top-4 z-[100] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm shadow-lg"
          >
            <div className="font-medium">Something went wrong</div>
            <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {this.state.error.message}
            </div>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
