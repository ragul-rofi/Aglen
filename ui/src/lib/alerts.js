const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function sortBySeverityAndDate(alerts) {
  return [...alerts].sort((a, b) => {
    const rankDiff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.last_updated_at || 0).getTime() - new Date(a.last_updated_at || 0).getTime();
  });
}

export async function fetchAlertsForUser(profile) {
  if (!profile?.location_state) return [];

  const params = new URLSearchParams({
    state: profile.location_state,
    is_active: 'true',
    limit: '100',
    offset: '0',
  });

  const res = await fetch(`${API_BASE}/alerts?${params.toString()}`);
  if (!res.ok) return [];

  const data = await res.json();
  return sortBySeverityAndDate(data);
}

export async function fetchAllAlerts(filters = {}) {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 20),
    offset: String(filters.offset ?? 0),
  });

  if (filters.state) params.set('state', filters.state);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.is_active !== undefined) params.set('is_active', String(filters.is_active));

  const res = await fetch(`${API_BASE}/alerts?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch alerts (${res.status})`);
  }

  const data = await res.json();
  return {
    items: sortBySeverityAndDate(data),
    limit: Number(params.get('limit')),
    offset: Number(params.get('offset')),
  };
}
