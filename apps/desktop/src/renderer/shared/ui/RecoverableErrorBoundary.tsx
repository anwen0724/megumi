/*
 * Local render error boundary for recoverable UI fragments.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { showToast } from './toast-store';
import { rendererI18n } from '../i18n';

interface RecoverableErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  message?: string;
  resetKey?: string;
}

interface RecoverableErrorBoundaryState {
  hasError: boolean;
}

export class RecoverableErrorBoundary extends Component<
  RecoverableErrorBoundaryProps,
  RecoverableErrorBoundaryState
> {
  state: RecoverableErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RecoverableErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    showToast({
      tone: 'error',
      title: this.props.title ?? rendererI18n.t('errors:render_failed'),
      message: this.props.message,
    });
  }

  componentDidUpdate(previousProps: RecoverableErrorBoundaryProps): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}
