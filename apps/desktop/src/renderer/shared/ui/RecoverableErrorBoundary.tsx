/*
 * Local render error boundary for recoverable UI fragments.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { showToast } from './toast-store';

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

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    showToast({
      tone: 'error',
      title: this.props.title ?? 'Something could not be displayed',
      message: this.props.message ?? error.message,
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
