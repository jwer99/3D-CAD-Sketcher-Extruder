
import React, { Component, StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
const App = lazy(() => import('./App.tsx'));
import './index.css';
const ServicesPage = lazy(() => import('./components/ServicesPage'));

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  state: { hasError: boolean; error: any } = { hasError: false, error: null };

  constructor(props: { children: React.ReactNode }) {
    super(props);
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: '20px', color: '#ff4444', backgroundColor: '#121212', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, overflow: 'auto'}}>
          <h2>Application Crash</h2>
          <pre style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '14px'}}>{this.state.error?.toString()}{"\n"}{this.state.error?.stack}</pre>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<p>Cargando VOXEL3D…</p>}>
        {window.location.pathname.replace(/\/$/, '') === '/servicios' ? <ServicesPage /> : <App />}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
