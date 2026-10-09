import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AEGIS Simulation UI Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 32,
          maxWidth: 800,
          margin: '40px auto',
          background: '#1a1d26',
          border: '1px solid #ef4444',
          borderRadius: 8,
          color: '#f87171',
          fontFamily: 'monospace',
        }}>
          <h2 style={{ color: '#ef4444', marginTop: 0 }}>⚠️ AEGIS Simulation Runtime Error</h2>
          <p style={{ color: '#e2e8f0', fontSize: 14 }}>
            An unexpected error occurred during rendering. Details below:
          </p>
          <pre style={{
            background: '#0d0f14',
            padding: 16,
            borderRadius: 6,
            overflow: 'auto',
            fontSize: 12,
            color: '#fca5a5',
            whiteSpace: 'pre-wrap',
          }}>
            {this.state.error?.stack || this.state.error?.message || 'Unknown error'}
          </pre>
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
