import { Component, type ReactNode } from 'react';

interface State { error: Error | null; }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <h2 className="text-red-400 text-lg mb-2">出错了</h2>
            <p className="text-gray-400 text-sm mb-4">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
