const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function ensureConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
}

function headers() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

function dayKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function rangeSeries(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function formatDiseaseName(raw = '') {
  const base = (raw.split('___').pop() || raw).replaceAll('_', ' ').trim();
  return base ? `${base.charAt(0).toUpperCase()}${base.slice(1)}` : 'Unknown disease';
}

export async function fetchScanStats({ startDate, endDate } = {}) {
  ensureConfig();

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();

  const params = new URLSearchParams({
    select: 'id,predicted_class,confidence,feedback,created_at,user_id,users(location_state)',
    created_at: `gte.${start.toISOString()}`,
    order: 'created_at.asc',
    limit: '20000',
  });

  const scansRes = await fetch(`${SUPABASE_URL}/rest/v1/scans?${params.toString()}`, {
    headers: headers(),
  });

  if (!scansRes.ok) {
    throw new Error(`Failed to fetch scans (${scansRes.status})`);
  }

  const allRows = await scansRes.json();
  const rows = allRows.filter((row) => new Date(row.created_at) <= end);

  const totalScans = rows.length;
  const todayKey = dayKey(new Date());
  const scansToday = rows.filter((row) => dayKey(row.created_at) === todayKey).length;
  const avgConfidence = totalScans
    ? rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / totalScans
    : 0;

  const feedbackRows = rows.filter((row) => ['confirmed', 'wrong', 'unsure'].includes(row.feedback));
  const feedbackRate = totalScans ? (feedbackRows.length / totalScans) * 100 : 0;

  const seriesDays = rangeSeries(start, end);
  const dailyMap = new Map(seriesDays.map((day) => [day, { date: day, total: 0, confirmed: 0 }]));

  const diseaseMap = new Map();
  const confidenceBuckets = {
    '0-60': 0,
    '60-70': 0,
    '70-80': 0,
    '80-90': 0,
    '90-100': 0,
  };

  const feedbackBreakdown = {
    Confirmed: 0,
    Wrong: 0,
    Unsure: 0,
    'No feedback': 0,
  };

  rows.forEach((row) => {
    const key = dayKey(row.created_at);
    const day = dailyMap.get(key);
    if (day) {
      day.total += 1;
      if (row.feedback === 'confirmed') day.confirmed += 1;
    }

    const disease = row.predicted_class || 'Unknown';
    diseaseMap.set(disease, (diseaseMap.get(disease) || 0) + 1);

    const confidencePct = Number(row.confidence || 0) * 100;
    if (confidencePct < 60) confidenceBuckets['0-60'] += 1;
    else if (confidencePct < 70) confidenceBuckets['60-70'] += 1;
    else if (confidencePct < 80) confidenceBuckets['70-80'] += 1;
    else if (confidencePct < 90) confidenceBuckets['80-90'] += 1;
    else confidenceBuckets['90-100'] += 1;

    if (row.feedback === 'confirmed') feedbackBreakdown.Confirmed += 1;
    else if (row.feedback === 'wrong') feedbackBreakdown.Wrong += 1;
    else if (row.feedback === 'unsure') feedbackBreakdown.Unsure += 1;
    else feedbackBreakdown['No feedback'] += 1;
  });

  const volumeSeries = [...dailyMap.values()];

  const topDiseases = [...diseaseMap.entries()]
    .map(([disease, count]) => ({ disease: formatDiseaseName(disease), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const confidenceDistribution = Object.entries(confidenceBuckets).map(([bucket, count]) => ({
    bucket,
    count,
    band: bucket === '0-60' ? 'low' : bucket === '60-70' || bucket === '70-80' ? 'mid' : 'high',
  }));

  const feedbackPie = Object.entries(feedbackBreakdown).map(([name, value]) => ({ name, value }));

  const confirmed = feedbackBreakdown.Confirmed;
  const wrong = feedbackBreakdown.Wrong;
  const modelAccuracy = confirmed + wrong === 0 ? 0 : (confirmed / (confirmed + wrong)) * 100;

  return {
    range: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    totals: {
      totalScans,
      scansToday,
      avgConfidence,
      feedbackRate,
      modelAccuracy,
    },
    charts: {
      volumeSeries,
      topDiseases,
      confidenceDistribution,
      feedbackPie,
    },
    rows,
  };
}

export async function fetchRecentActivity(limit = 20) {
  ensureConfig();

  const [usersRes, scansRes, alertsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/users?select=id,full_name,email,created_at&order=created_at.desc&limit=${limit}`, { headers: headers() }),
    fetch(`${SUPABASE_URL}/rest/v1/scans?select=id,user_id,predicted_class,feedback,created_at&order=created_at.desc&limit=${limit}`, { headers: headers() }),
    fetch(`${SUPABASE_URL}/rest/v1/disease_alerts?select=id,disease_class,severity,created_at&order=created_at.desc&limit=${Math.max(10, Math.floor(limit / 2))}`, { headers: headers() }),
  ]);

  if (!usersRes.ok || !scansRes.ok || !alertsRes.ok) {
    throw new Error('Failed to fetch activity feed data.');
  }

  const [users, scans, alerts] = await Promise.all([usersRes.json(), scansRes.json(), alertsRes.json()]);

  const events = [
    ...users.map((user) => ({
      id: `u-${user.id}`,
      created_at: user.created_at,
      initials: (user.full_name || user.email || 'U').slice(0, 2).toUpperCase(),
      action: `${user.full_name || user.email} signed up`,
      type: 'user',
    })),
    ...scans.map((scan) => ({
      id: `s-${scan.id}`,
      created_at: scan.created_at,
      initials: 'SC',
      action: `New scan: ${formatDiseaseName(scan.predicted_class)}`,
      type: 'scan',
    })),
    ...scans
      .filter((scan) => scan.feedback)
      .map((scan) => ({
        id: `f-${scan.id}`,
        created_at: scan.created_at,
        initials: 'FB',
        action: `Feedback submitted: ${scan.feedback}`,
        type: 'feedback',
      })),
    ...alerts.map((alert) => ({
      id: `a-${alert.id}`,
      created_at: alert.created_at,
      initials: 'AL',
      action: `Alert created: ${formatDiseaseName(alert.disease_class)} (${alert.severity})`,
      type: 'alert',
    })),
  ]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  return events;
}
