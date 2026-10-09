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
          background: '#fff4ef',
          border: '1px solid #e8a090',
          borderRadius: 28,
          color: '#c45c4a',
          fontFamily: 'Inter, system-ui, sans-serif',
          boxShadow: '0 24px 60px rgba(90, 40, 28, 0.18)',
        }}>
          <h2 style={{ color: '#c45c4a', marginTop: 0 }}>AEGIS Simulation Runtime Error</h2>
          <p style={{ color: '#3d3229', fontSize: 14 }}>
            An unexpected error occurred during rendering. Details below:
          </p>
          <pre style={{
            background: '#fff8f4',
            padding: 16,
            borderRadius: 16,
            overflow: 'auto',
            fontSize: 12,
            color: '#8a3d32',
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
                background: '#c45c4a',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 12,
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
