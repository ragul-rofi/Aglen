import { useMemo, useState } from 'react';

const DISMISS_KEY = 'aglen.dismissed_alert_ids';

function getDismissedIds() {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistDismissedIds(ids) {
  window.localStorage.setItem(DISMISS_KEY, JSON.stringify(ids));
}

function formatDiseaseName(value = '') {
  const cleaned = value.split('___').pop() || value;
  return cleaned.replaceAll('_', ' ');
}

export default function AlertBanner({ alerts }) {
  const [expanded, setExpanded] = useState(() => ({}));
  const [dismissed, setDismissed] = useState(() => getDismissedIds());

  const visibleAlerts = useMemo(
    () => alerts.filter((item) => !dismissed.includes(item.id)),
    [alerts, dismissed],
  );

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="alert-banner-list" role="status" aria-live="polite">
      {visibleAlerts.map((alert) => {
        const isOpen = Boolean(expanded[alert.id]);
        const district = alert.affected_district || 'multiple districts';

        return (
          <article key={alert.id} className={`alert-banner alert-banner--${alert.severity}`}>
            <button
              type="button"
              className="alert-banner__main"
              onClick={() => setExpanded((prev) => ({ ...prev, [alert.id]: !isOpen }))}
            >
              <strong>
                {formatDiseaseName(alert.disease_class)} outbreak detected in {district}, {alert.affected_state}
              </strong>
              <span>{isOpen ? 'Hide details' : 'View advisory'}</span>
            </button>

            <button
              type="button"
              className="alert-banner__dismiss"
              aria-label="Dismiss alert"
              onClick={() => {
                const next = [...dismissed, alert.id];
                setDismissed(next);
                persistDismissedIds(next);
              }}
            >
              Dismiss
            </button>

            {isOpen && <p className="alert-banner__advisory">{alert.advisory_text || 'No advisory text available.'}</p>}
          </article>
        );
      })}
    </div>
  );
}
