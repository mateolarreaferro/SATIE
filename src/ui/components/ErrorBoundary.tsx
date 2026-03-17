import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches render errors in a subtree.
 * Use around individual panels so one crash doesn't take down the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          padding: '16px',
          fontSize: '11px',
          fontFamily: "'SF Mono', monospace",
          color: '#8b0000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '8px',
          opacity: 0.7,
        }}>
          <div style={{ fontWeight: 600 }}>
            {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
          </div>
          <div style={{ fontSize: '9px', opacity: 0.6, maxWidth: 200, textAlign: 'center', wordBreak: 'break-word' }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '4px 12px',
              background: 'none',
              border: '1px solid #8b0000',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '10px',
              color: '#8b0000',
              fontFamily: "'Inter', system-ui, sans-serif",
              marginTop: '4px',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
