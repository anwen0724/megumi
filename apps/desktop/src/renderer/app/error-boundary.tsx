import { Component, type ReactNode } from 'react';
import { rendererI18n } from '../shared/i18n';

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
            <div className="font-medium">{rendererI18n.t('errors:app_render_failed')}</div>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
            >
              {rendererI18n.t('common:actions.retry')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
