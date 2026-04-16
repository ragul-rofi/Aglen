import { useEffect, useMemo, useState } from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchRecentActivity, fetchScanStats } from '../../lib/analytics';
import { fetchAllAlerts } from '../../lib/alerts';
import { fetchUsers } from '../../lib/admin';

function timeAgo(value) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / (60 * 1000));
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [feed, setFeed] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const now = new Date();
        const start14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        const [scanStats, userStats, alertStats, recent] = await Promise.all([
          fetchScanStats({ startDate: start14, endDate: now }),
          fetchUsers({ page: 1, limit: 1 }),
          fetchAllAlerts({ is_active: true, limit: 20, offset: 0 }),
          fetchRecentActivity(20),
        ]);

        if (ignore) return;

        setStats({
          totalUsers: userStats.count,
          scansToday: scanStats.totals.scansToday,
          criticalAlerts: alertStats.items.filter((item) => item.severity === 'critical').length,
          modelAccuracy: Math.round(scanStats.totals.modelAccuracy),
          trend14: scanStats.charts.volumeSeries.slice(-14),
        });
        setAlerts(alertStats.items.slice(0, 5));
        setFeed(recent);
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load admin overview');
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, []);

  const visibleAlerts = useMemo(
    () => alerts.filter((item) => !dismissed.includes(item.id)),
    [alerts, dismissed],
  );

  return (
    <section className="admin-overview-page">
      {error && <p className="page-error">{error}</p>}

      <div className="admin-overview-hero">
        <article><p>Total users</p><strong>{stats?.totalUsers ?? 0}</strong></article>
        <article><p>Scans today</p><strong>{stats?.scansToday ?? 0}</strong></article>
        <article><p>Critical alerts</p><strong>{stats?.criticalAlerts ?? 0}</strong></article>
        <article><p>Model accuracy</p><strong>{stats?.modelAccuracy ?? 0}%</strong></article>
      </div>

      <div className="admin-overview-columns">
        <article className="chart-card">
          <h3>Scan volume (14 days)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stats?.trend14 || []}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="#1a3c2b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="admin-overview-alerts">
          <h3>Active alerts</h3>
          <ul>
            {visibleAlerts.map((alert) => (
              <li key={alert.id}>
                <div>
                  <strong>{alert.disease_class.replaceAll('_', ' ')}</strong>
                  <span className={`alerts-badge alerts-badge--${alert.severity}`}>{alert.severity}</span>
                </div>
                <button type="button" onClick={() => setDismissed((prev) => [...prev, alert.id])}>Dismiss</button>
              </li>
            ))}
            {visibleAlerts.length === 0 && <li>No active alerts</li>}
          </ul>
        </article>
      </div>

      <article className="admin-activity-feed">
        <h3>Recent activity</h3>
        <ul>
          {feed.map((event) => (
            <li key={event.id}>
              <span className="activity-avatar">{event.initials}</span>
              <div>
                <p>{event.action}</p>
                <small>{timeAgo(event.created_at)}</small>
              </div>
            </li>
          ))}
          {feed.length === 0 && <li>No recent activity</li>}
        </ul>
      </article>
    </section>
  );
}
