import { useEffect, useMemo, useState } from 'react';
import AlertBanner from '../../components/AlertBanner';
import { fetchAlertsForUser } from '../../lib/alerts';
import { useScanStore } from '../../store/scanStore';

function formatDiseaseName(value = '') {
  const cleaned = value.split('___').pop() || value;
  return cleaned.replaceAll('_', ' ');
}

export default function DashboardPage({ user }) {
  const scans = useScanStore((state) => state.scans);
  const fetchScans = useScanStore((state) => state.fetchScans);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    fetchScans(user.id, true);
  }, [fetchScans, user.id]);

  useEffect(() => {
    let ignore = false;
    async function loadAlerts() {
      try {
        const rows = await fetchAlertsForUser({ location_state: user.state });
        if (!ignore) setAlerts(rows);
      } catch {
        if (!ignore) setAlerts([]);
      }
    }
    loadAlerts();
    return () => {
      ignore = true;
    };
  }, [user.state]);

  const stats = useMemo(() => {
    const total = scans.length;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthCount = scans.filter((item) => new Date(item.created_at) >= monthStart).length;

    const frequency = scans.reduce((acc, scan) => {
      const key = scan.predicted_class || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const top = Object.entries(frequency).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No scans yet';

    return {
      total,
      monthCount,
      top,
    };
  }, [scans]);

  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <p>Welcome back</p>
        <h2>{user.name}</h2>
      </header>

      <AlertBanner alerts={alerts} />

      <div className="stats-grid">
        <article>
          <h3>Total scans</h3>
          <p>{stats.total}</p>
        </article>
        <article>
          <h3>This month</h3>
          <p>{stats.monthCount}</p>
        </article>
        <article>
          <h3>Most detected</h3>
          <p>{formatDiseaseName(stats.top)}</p>
        </article>
      </div>

      <button type="button" className="scan-now-card">
        <span>Scan now</span>
        <small>Capture and diagnose a new leaf instantly.</small>
      </button>

      <section className="dashboard-list">
        <h3>Recent scans</h3>
        <ul>
          {scans.slice(0, 5).map((scan) => (
            <li key={scan.id}>
              <span>{formatDiseaseName(scan.predicted_class)}</span>
              <span>{Math.round((scan.confidence ?? 0) * 100)}%</span>
            </li>
          ))}
          {scans.length === 0 && <li>No scans yet.</li>}
        </ul>
      </section>

      <section className="dashboard-alerts">
        <h3>Active alerts in {user.state}</h3>
        <ul>
          {alerts.length === 0 && <li>No active alerts.</li>}
          {alerts.map((alert) => (
            <li key={alert.id}>
              <strong>{formatDiseaseName(alert.disease_class)}</strong>
              <span>{alert.severity}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
