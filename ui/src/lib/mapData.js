const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function ensureConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

function getUserObj(row) {
  const user = row?.users;
  if (Array.isArray(user)) return user[0] || {};
  return user || {};
}

function severityFromCount(count) {
  if (count >= 50) return 'critical';
  if (count >= 25) return 'high';
  if (count >= 10) return 'medium';
  return 'low';
}

function severityPassesFilter(count, filter) {
  if (filter === 'critical') return count >= 50;
  if (filter === 'high_plus') return count >= 25;
  if (filter === 'medium_plus') return count >= 10;
  return true;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function buildDailySeries(rows, startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const counts = new Map();

  rows.forEach((row) => {
    const key = dayKey(row.created_at);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const series = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor);
    series.push({ date: key, count: counts.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

function aggregateRows(rows, metric) {
  const stateMap = new Map();
  const diseaseTotals = new Map();

  rows.forEach((row) => {
    const user = getUserObj(row);
    const state = user.location_state || 'Unknown';
    const district = user.location_district || 'Unknown';
    const disease = row.predicted_class || 'Unknown';

    if (!stateMap.has(state)) {
      stateMap.set(state, {
        state,
        totalScans: 0,
        confirmedCases: 0,
        diseaseCounts: new Map(),
        districtCounts: new Map(),
        rows: [],
      });
    }

    const entry = stateMap.get(state);
    entry.totalScans += 1;
    if (row.feedback === 'confirmed') entry.confirmedCases += 1;
    entry.rows.push(row);
    entry.diseaseCounts.set(disease, (entry.diseaseCounts.get(disease) || 0) + 1);
    entry.districtCounts.set(district, (entry.districtCounts.get(district) || 0) + 1);

    diseaseTotals.set(disease, (diseaseTotals.get(disease) || 0) + 1);
  });

  const states = [...stateMap.values()].map((item) => {
    const topDisease = [...item.diseaseCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
    let value = item.totalScans;
    if (metric === 'confirmed_cases') value = item.confirmedCases;
    if (metric === 'disease_prevalence') {
      value = item.totalScans === 0 ? 0 : Math.round((item.confirmedCases / item.totalScans) * 100);
    }

    return {
      state: item.state,
      value,
      totalScans: item.totalScans,
      confirmedCases: item.confirmedCases,
      topDisease,
      diseaseCounts: item.diseaseCounts,
      districtCounts: item.districtCounts,
      rows: item.rows,
    };
  });

  return { states, diseaseTotals };
}

async function fetchAlertsForState(state) {
  const params = new URLSearchParams({ state, is_active: 'true', limit: '25', offset: '0' });
  const res = await fetch(`${API_BASE}/alerts?${params.toString()}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchOutbreakData({
  startDate,
  endDate,
  diseaseClass = 'all',
  metric = 'scan_volume',
  severityFilter = 'all',
} = {}) {
  ensureConfig();

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - days);

  const params = new URLSearchParams({
    select: 'id,predicted_class,feedback,created_at,confidence,users(location_state,location_district)',
    created_at: `gte.${previousStart.toISOString()}`,
    order: 'created_at.asc',
    limit: '15000',
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/scans?${params.toString()}`, {
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to load outbreak data (${res.status})`);
  }

  const allRows = await res.json();
  const currentRows = allRows.filter((row) => {
    const created = new Date(row.created_at);
    if (created < start || created > end) return false;
    if (diseaseClass !== 'all' && row.predicted_class !== diseaseClass) return false;
    return true;
  });

  const previousRows = allRows.filter((row) => {
    const created = new Date(row.created_at);
    if (created < previousStart || created >= start) return false;
    if (diseaseClass !== 'all' && row.predicted_class !== diseaseClass) return false;
    return true;
  });

  const currentAggregated = aggregateRows(currentRows, metric);
  const previousAggregated = aggregateRows(previousRows, metric);

  const previousDiseaseMap = previousAggregated.diseaseTotals;

  const topDiseases = [...currentAggregated.diseaseTotals.entries()]
    .map(([name, count]) => {
      const prevCount = previousDiseaseMap.get(name) || 0;
      return {
        disease: name,
        count,
        prevCount,
        trend: count >= prevCount ? 'up' : 'down',
        severity: severityFromCount(count),
      };
    })
    .filter((item) => severityPassesFilter(item.count, severityFilter))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const states = currentAggregated.states
    .map((stateItem) => {
      const diseaseArray = [...stateItem.diseaseCounts.entries()]
        .map(([disease, count]) => ({ disease, count, severity: severityFromCount(count) }))
        .filter((item) => severityPassesFilter(item.count, severityFilter))
        .sort((a, b) => b.count - a.count);

      const districtArray = [...stateItem.districtCounts.entries()]
        .map(([district, count]) => ({ district, count, severity: severityFromCount(count) }))
        .filter((item) => severityPassesFilter(item.count, severityFilter))
        .sort((a, b) => b.count - a.count);

      const filteredTotal = diseaseArray.reduce((sum, item) => sum + item.count, 0);

      return {
        state: stateItem.state,
        value: metric === 'disease_prevalence'
          ? stateItem.totalScans === 0
            ? 0
            : Math.round((filteredTotal / stateItem.totalScans) * 100)
          : metric === 'confirmed_cases'
            ? stateItem.rows.filter((row) => row.feedback === 'confirmed').length
            : filteredTotal,
        totalScans: stateItem.totalScans,
        confirmedCases: stateItem.confirmedCases,
        topDisease: diseaseArray[0]?.disease || stateItem.topDisease,
        diseases: diseaseArray,
        districts: districtArray,
        trend: buildDailySeries(stateItem.rows, start, end).slice(-7),
      };
    })
    .sort((a, b) => b.value - a.value);

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    states,
    topDiseases,
    uniqueDiseases: [...new Set(currentRows.map((row) => row.predicted_class).filter(Boolean))].sort(),
    fetchAlertsForState,
  };
}

export async function fetchIndiaGeoJson() {
  const url = 'https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load India GeoJSON.');
  return res.json();
}

export function getGeoStateName(geoProps = {}) {
  return (
    geoProps.st_nm ||
    geoProps.ST_NM ||
    geoProps.NAME_1 ||
    geoProps.name ||
    geoProps.NAME ||
    'Unknown'
  );
}

export function formatDiseaseName(raw = '') {
  const base = (raw.split('___').pop() || raw).replaceAll('_', ' ').trim();
  return base ? `${base.charAt(0).toUpperCase()}${base.slice(1)}` : 'Unknown disease';
}
