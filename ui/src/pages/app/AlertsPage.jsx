import { useEffect, useState } from 'react';
import { fetchAlertsForUser } from '../../lib/alerts';

function formatDiseaseName(value = '') {
  const cleaned = value.split('___').pop() || value;
  return cleaned.replaceAll('_', ' ');
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AlertsPage({ profile }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      try {
        const rows = await fetchAlertsForUser(profile);
        if (!ignore) setAlerts(rows);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [profile]);

  if (loading) {
    return <p className="history-state">Loading alerts...</p>;
  }

  if (alerts.length === 0) {
    return <p className="alerts-empty">No active alerts in your region</p>;
  }

  return (
    <section className="alerts-page">
      {alerts.map((alert) => (
        <article key={alert.id} className="alerts-card">
          <div className="alerts-card__head">
            <h3>{formatDiseaseName(alert.disease_class)}</h3>
            <span className={`alerts-badge alerts-badge--${alert.severity}`}>{alert.severity}</span>
          </div>
          <p className="alerts-card__meta">Cases: {alert.case_count ?? 0}</p>
          <p className="alerts-card__meta">First detected: {formatDate(alert.first_detected_at)}</p>
          <p className="alerts-card__advisory">{alert.advisory_text || 'No advisory text available.'}</p>
        </article>
      ))}
    </section>
  );
}
