import { useEffect, useMemo, useState } from 'react';
import AlertsPage from '../app/AlertsPage';
import AdminLayout from './AdminLayout';
import AdminOverviewPage from './AdminOverviewPage';
import OutbreakMapPage from './OutbreakMapPage';
import ScanAnalyticsPage from './ScanAnalyticsPage';
import UsersPage from './UsersPage';

const ADMIN_ROUTES = ['/', '/users', '/scans', '/alerts', '/map', '/health'];

function normalizeAdminPath(pathname = '/') {
  if (!pathname) return '/';

  const withoutAdminPrefix = pathname.startsWith('/admin')
    ? pathname.slice('/admin'.length) || '/'
    : pathname;

  const withoutQuery = withoutAdminPrefix.split('?')[0] || '/';
  const withoutHash = withoutQuery.split('#')[0] || '/';
  const clean = withoutHash !== '/' && withoutHash.endsWith('/')
    ? withoutHash.slice(0, -1)
    : withoutHash;
  return ADMIN_ROUTES.includes(clean) ? clean : '/';
}

function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const [healthRes, metricsRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/health`),
          fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/metrics`),
        ]);

        if (!healthRes.ok || !metricsRes.ok) {
          throw new Error('Failed to load backend health metrics.');
        }

        const [healthPayload, metricsPayload] = await Promise.all([
          healthRes.json(),
          metricsRes.json(),
        ]);

        if (!ignore) {
          setHealth(healthPayload);
          setMetrics(metricsPayload);
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Unable to load system health.');
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="admin-placeholder">
      <h2>System health</h2>
      <p>Runtime checks for API readiness and inference performance.</p>
      {error && <p className="page-error">{error}</p>}
      <ul className="admin-inline-list">
        <li>
          <span>API status</span>
          <strong>{health?.status || 'unknown'}</strong>
        </li>
        <li>
          <span>Model ready</span>
          <strong>{health?.ready ? 'yes' : 'no'}</strong>
        </li>
        <li>
          <span>Device</span>
          <strong>{health?.device || 'unknown'}</strong>
        </li>
        <li>
          <span>Predict requests</span>
          <strong>{metrics?.predict?.count ?? 0}</strong>
        </li>
        <li>
          <span>Explain avg latency</span>
          <strong>{metrics?.explain?.avg_ms ?? 0} ms</strong>
        </li>
      </ul>
    </section>
  );
}

function Placeholder({ title, subtitle }) {
  return (
    <section className="admin-placeholder">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </section>
  );
}

export default function AdminCommandCenter({ adminName = 'Admin User', onSignOut, onBackToFarmer }) {
  const [path, setPath] = useState(() => normalizeAdminPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizeAdminPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(nextPath) {
    const normalized = normalizeAdminPath(nextPath);
    setPath(normalized);
    const browserPath = normalized === '/' ? '/admin' : `/admin${normalized}`;
    window.history.pushState({}, '', browserPath);
  }

  const content = useMemo(() => {
    if (path === '/users') {
      return <UsersPage onOpenUserScans={() => navigate('/scans')} />;
    }
    if (path === '/scans') return <ScanAnalyticsPage />;
    if (path === '/alerts') return <AlertsPage profile={{ location_state: 'Karnataka' }} />;
    if (path === '/map') return <OutbreakMapPage />;
    if (path === '/health') return <SystemHealthPage />;
    return <AdminOverviewPage />;
  }, [path]);

  return (
    <AdminLayout
      activePath={path}
      adminName={adminName}
      onNavigate={navigate}
      onSignOut={onSignOut}
    >
      <div className="admin-command-top">
        <button type="button" className="admin-btn" onClick={onBackToFarmer}>Back to farmer app</button>
      </div>
      {content}
    </AdminLayout>
  );
}
